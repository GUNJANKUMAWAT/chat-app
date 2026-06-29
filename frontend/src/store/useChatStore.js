import { create } from "zustand";
import { axiosInstance } from "../lib/axios";
import toast from "react-hot-toast";
import { useAuthStore } from "./useAuthStore";
import { encryptMessage, decryptMessage } from "../lib/crypto";

export const useChatStore = create((set, get) => ({
    messages: [],
    users: [],
    selectedUser: null,
    isUsersLoading: false,
    isMessagesLoading: false,

    getUsers: async () => {
        set({ isUsersLoading: true });
        try{
            const res = await axiosInstance.get("/messages/users");
            set({ users: res.data });
        } catch(error){
            toast.error(error.response.data.message);
        } finally{
            set({ isUsersLoading: false });
        }
    },

    getMessages: async (userId) => {
        set({ isMessagesLoading: true });
        try{
            const res = await axiosInstance.get(`/messages/${userId}`);
            const authUser = useAuthStore.getState().authUser;
            const privateKeyRaw = localStorage.getItem(`chat-private-key-${authUser?._id}`);
            const privateKeyJwk = privateKeyRaw ? JSON.parse(privateKeyRaw) : null;

            const decryptedMessages = await Promise.all(res.data.map(async (msg) => {
                if (msg.isEncrypted && privateKeyJwk) {
                    const decrypted = await decryptMessage(msg, privateKeyJwk, authUser?._id);
                    return { ...msg, text: decrypted.text, image: decrypted.image };
                }
                return msg;
            }));

            set({ messages: decryptedMessages });
        } catch(error){
            toast.error(error.response.data.message);
        } finally{
            set({ isMessagesLoading: false });
        }
    },

    sendMessage: async(messageData) => {
        const {selectedUser, messages} = get();
        const authUser = useAuthStore.getState().authUser;

        let payload = messageData;
        if (selectedUser?.publicKey && authUser?.publicKey) {
            try {
                const receiverPublicKeyJwk = JSON.parse(selectedUser.publicKey);
                const senderPublicKeyJwk = JSON.parse(authUser.publicKey);
                
                const encryptedData = await encryptMessage(
                    messageData.text,
                    messageData.image,
                    receiverPublicKeyJwk,
                    senderPublicKeyJwk
                );

                payload = {
                    ...encryptedData,
                    isEncrypted: true
                };
            } catch (error) {
                console.error("Failed to encrypt message:", error);
            }
        }

        try{
            const res = await axiosInstance.post(`/messages/send/${selectedUser._id}`, payload);
            
            let localMsg = res.data;
            const privateKeyRaw = localStorage.getItem(`chat-private-key-${authUser?._id}`);
            const privateKeyJwk = privateKeyRaw ? JSON.parse(privateKeyRaw) : null;

            if (localMsg.isEncrypted && privateKeyJwk) {
                const decrypted = await decryptMessage(localMsg, privateKeyJwk, authUser?._id);
                localMsg = { ...localMsg, text: decrypted.text, image: decrypted.image };
            }

            set({ messages: [...messages, localMsg] });
        } catch(error){
            toast.error(error.response.data.message);
            throw error;
        }
    },

    subscribeToMessages: () => {
        const { selectedUser } = get();
        if(!selectedUser) return;

        const socket = useAuthStore.getState().socket;

        socket.on("newMessage", async (newMessage) => {
            const isMessageSentFromSelectedUser = newMessage.senderId === selectedUser._id;
            if(!isMessageSentFromSelectedUser) return;

            const authUser = useAuthStore.getState().authUser;
            const privateKeyRaw = localStorage.getItem(`chat-private-key-${authUser?._id}`);
            const privateKeyJwk = privateKeyRaw ? JSON.parse(privateKeyRaw) : null;

            let processedMessage = newMessage;
            if (newMessage.isEncrypted && privateKeyJwk) {
                const decrypted = await decryptMessage(newMessage, privateKeyJwk, authUser?._id);
                processedMessage = { ...newMessage, text: decrypted.text, image: decrypted.image };
            }

            set({
                messages: [...get().messages, processedMessage],
            });
        });    
    },

    unSubscribeFromMessages: () => {
        const socket = useAuthStore.getState().socket;
        socket.off("newMessage");
    },

    setSelectedUser: (selectedUser) => set({ selectedUser }),
}));