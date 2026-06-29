import { create } from "zustand";
import { axiosInstance } from "../lib/axios";
import toast from "react-hot-toast";
import { io } from "socket.io-client";
import { generateCryptoKeyPair } from "../lib/crypto";

const BASE_URL = import.meta.env.MODE === "development" ? "http://localhost:5001" : "/";

export const useAuthStore = create((set, get) => ({
    authUser: null,
    isSigningUp: false,
    isLoggingIn: false,
    isUpdatingProfile: false,
    isCheckingAuth: true,
    onlineUsers: [],
    socket: null,
    checkAuth: async () => {
        try{
            const res = await axiosInstance.get("/auth/check");
            set({ authUser: res.data });
            await get().initCryptoKeys();
            get().connectSocket();
        } catch(error){
            console.log("Error in checkAuth:", error.message);
            set({ authUser: null });
        } finally{
            set({ isCheckingAuth: false });
        }    
    },
    signup: async (data) => {
        set({ isSigningUp: true });
        try{
            const res = await axiosInstance.post("/auth/signup", data);
            set({ authUser: res.data });
            toast.success("Signup successful!");
            await get().initCryptoKeys();
            get().connectSocket();
        } catch(error){
            toast.error(error.response.data.message);
        } finally{
            set({ isSigningUp: false });
        }
    },
    login: async (data) => {
        set({ isLoggingIn: true });
        try{
            const res = await axiosInstance.post("/auth/login", data);
            set({ authUser: res.data });
            toast.success("Login successful!");
            await get().initCryptoKeys();
            get().connectSocket();
        } catch(error){
            toast.error(error.response.data.message);
        } finally{
            set({ isLoggingIn: false });
        }
    },
    logout: async () => {
        try{
            await axiosInstance.post("/auth/logout");
            set({ authUser: null });
            toast.success("Logged out successfully!");
            get().disconnectSocket();
        } catch(error){
            toast.error(error.response.data.message);
        }   
    },
    updateProfile: async (data) => {
        set({ isUpdatingProfile: true });
        try{
            const res = await axiosInstance.put("/auth/update-profile", data);
            set({ authUser: res.data });
            toast.success("Profile updated successfully!");
        } catch(error){
            console.log("Error in update profile:", error);
            toast.error(error.response?.data?.message);
        } finally{
            set({ isUpdatingProfile: false });
        }
    },
    connectSocket: () => {
        const { authUser, socket } = get();
        if(!authUser || socket) return;

        const newSocket = io(BASE_URL, {
            query: {
                userId: authUser._id,
            },
        });
        newSocket.connect();
        
        set({ socket: newSocket });

        newSocket.on("getOnlineUsers", (userIds) => {
            set({ onlineUsers: userIds });
        });
    },
    disconnectSocket: () => {
        const { socket } = get();
        if(socket) {
            socket.disconnect();
            set({ socket: null, onlineUsers: [] });
        }
    },
    initCryptoKeys: async () => {
        const { authUser } = get();
        if (!authUser) return;

        const storageKey = `chat-private-key-${authUser._id}`;
        const privateKeyJwk = localStorage.getItem(storageKey);

        // Only generate and upload if we don't have both a local private key AND a server public key
        if (!privateKeyJwk || !authUser.publicKey) {
            try {
                const { publicKeyJwk, privateKeyJwk: newPrivateKeyJwk } = await generateCryptoKeyPair();
                
                // Save private key locally in the browser only
                localStorage.setItem(storageKey, JSON.stringify(newPrivateKeyJwk));
                
                // Upload public key to the server (fire and forget — don't update state)
                await axiosInstance.put("/auth/update-public-key", {
                    publicKey: JSON.stringify(publicKeyJwk)
                });

                // Silently patch only the publicKey field on the existing authUser object
                // This avoids triggering a full Zustand re-render loop
                set((state) => ({
                    authUser: state.authUser
                        ? { ...state.authUser, publicKey: JSON.stringify(publicKeyJwk) }
                        : state.authUser
                }));
            } catch (error) {
                console.error("Failed to initialize cryptographic keys:", error);
            }
        }
    },
}));    