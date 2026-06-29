function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Generates an RSA-OAEP 2048-bit public/private key pair.
 * @returns {Promise<{publicKeyJwk: Object, privateKeyJwk: Object}>}
 */
export async function generateCryptoKeyPair() {
  const keyPair = await window.crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true, // extractable
    ["encrypt", "decrypt"]
  );

  const publicKeyJwk = await window.crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const privateKeyJwk = await window.crypto.subtle.exportKey("jwk", keyPair.privateKey);

  return { publicKeyJwk, privateKeyJwk };
}

/**
 * Encrypts raw text and imageBase64 (if present) using AES-GCM.
 * The AES key is then encrypted with both the receiver's and sender's public keys.
 * @returns {Promise<{text: string, image: string|null, iv: string, encryptedKeyForReceiver: string, encryptedKeyForSender: string}>}
 */
export async function encryptMessage(text, imageBase64, receiverPublicKeyJwk, senderPublicKeyJwk) {
  // 1. Generate a random AES key
  const aesKey = await window.crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256,
    },
    true,
    ["encrypt", "decrypt"]
  );

  // 2. Encrypt text
  const textEncoder = new TextEncoder();
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encryptedTextBuffer = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    aesKey,
    textEncoder.encode(text || "")
  );
  const encryptedTextBase64 = arrayBufferToBase64(encryptedTextBuffer);

  // 3. Encrypt image if present
  let encryptedImageBase64 = null;
  if (imageBase64) {
    const encryptedImageBuffer = await window.crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv,
      },
      aesKey,
      textEncoder.encode(imageBase64)
    );
    encryptedImageBase64 = arrayBufferToBase64(encryptedImageBuffer);
  }

  // 4. Export the AES key to encrypt it with RSA
  const aesKeyRaw = await window.crypto.subtle.exportKey("raw", aesKey);

  // 5. Import RSA public keys
  const receiverPublicKey = await window.crypto.subtle.importKey(
    "jwk",
    receiverPublicKeyJwk,
    {
      name: "RSA-OAEP",
      hash: "SHA-256",
    },
    false,
    ["encrypt"]
  );

  const senderPublicKey = await window.crypto.subtle.importKey(
    "jwk",
    senderPublicKeyJwk,
    {
      name: "RSA-OAEP",
      hash: "SHA-256",
    },
    false,
    ["encrypt"]
  );

  // 6. Encrypt AES key for receiver and sender
  const encryptedKeyForReceiverBuffer = await window.crypto.subtle.encrypt(
    {
      name: "RSA-OAEP",
    },
    receiverPublicKey,
    aesKeyRaw
  );

  const encryptedKeyForSenderBuffer = await window.crypto.subtle.encrypt(
    {
      name: "RSA-OAEP",
    },
    senderPublicKey,
    aesKeyRaw
  );

  return {
    text: encryptedTextBase64,
    image: encryptedImageBase64,
    iv: arrayBufferToBase64(iv),
    encryptedKeyForReceiver: arrayBufferToBase64(encryptedKeyForReceiverBuffer),
    encryptedKeyForSender: arrayBufferToBase64(encryptedKeyForSenderBuffer),
  };
}

/**
 * Decrypts a message's text and image using the user's private key.
 * @returns {Promise<{text: string, image: string|null}>}
 */
export async function decryptMessage(msg, privateKeyJwk, currentUserId) {
  if (!msg.isEncrypted) {
    return { text: msg.text, image: msg.image };
  }

  try {
    // 1. Import private key
    const privateKey = await window.crypto.subtle.importKey(
      "jwk",
      privateKeyJwk,
      {
        name: "RSA-OAEP",
        hash: "SHA-256",
      },
      false,
      ["decrypt"]
    );

    // 2. Determine which encrypted key to use
    const isSender = msg.senderId === currentUserId;
    const encryptedKeyBase64 = isSender ? msg.encryptedKeyForSender : msg.encryptedKeyForReceiver;

    if (!encryptedKeyBase64) {
      throw new Error("No encrypted key found for this user");
    }

    const encryptedKeyBuffer = base64ToArrayBuffer(encryptedKeyBase64);

    // 3. Decrypt the AES key
    const aesKeyRaw = await window.crypto.subtle.decrypt(
      {
        name: "RSA-OAEP",
      },
      privateKey,
      encryptedKeyBuffer
    );

    // 4. Import the AES key
    const aesKey = await window.crypto.subtle.importKey(
      "raw",
      aesKeyRaw,
      {
        name: "AES-GCM",
        length: 256,
      },
      false,
      ["decrypt"]
    );

    // 5. Decrypt text
    const textDecoder = new TextDecoder();
    const ivBuffer = base64ToArrayBuffer(msg.iv);
    
    let decryptedText = "";
    if (msg.text) {
      const decryptedTextBuffer = await window.crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: ivBuffer,
        },
        aesKey,
        base64ToArrayBuffer(msg.text)
      );
      decryptedText = textDecoder.decode(decryptedTextBuffer);
    }

    // 6. Decrypt image if present
    let decryptedImage = null;
    if (msg.image) {
      const decryptedImageBuffer = await window.crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: ivBuffer,
        },
        aesKey,
        base64ToArrayBuffer(msg.image)
      );
      decryptedImage = textDecoder.decode(decryptedImageBuffer);
    }

    return { text: decryptedText, image: decryptedImage };
  } catch (error) {
    console.error("Failed to decrypt message:", error);
    return { text: "[Decryption Failed: Private key missing or invalid]", image: null };
  }
}
