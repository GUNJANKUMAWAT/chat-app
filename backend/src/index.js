import express from "express";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import cors from "cors";

import path from "path";

import { connectDB } from "./lib/db.js";
import User from "./models/user.model.js";
import Message from "./models/message.model.js";

import authRoutes from "./routes/auth.route.js";
import messageRoutes from "./routes/message.route.js";
import { app, server } from "./lib/socket.js";

dotenv.config();

import { fileURLToPath } from "url";

const PORT = process.env.PORT;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));
app.use(cookieParser());
app.use(cors({
    origin: "http://localhost:5173",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
}));

app.use("/api/auth", authRoutes);
app.use("/api/messages", messageRoutes);

if(process.env.NODE_ENV === "production"){
    app.use(express.static(path.join(__dirname, "../..", "frontend/dist")));

    app.get("*all", (req, res) => {
        res.sendFile(path.join(__dirname, "../..", "frontend", "dist", "index.html"));
    });
}    

async function cleanInactiveUsers() {
    try {
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        // Find users created more than 24 hours ago
        const users = await User.find({ createdAt: { $lt: oneDayAgo } });
        
        let deletedCount = 0;
        for (const user of users) {
            const msgCount = await Message.countDocuments({
                $or: [
                    { senderId: user._id },
                    { receiverId: user._id }
                ]
            });
            if (msgCount === 0) {
                await User.findByIdAndDelete(user._id);
                deletedCount++;
            }
        }
        if (deletedCount > 0) {
            console.log(`[Database Cleanup] Automatically deleted ${deletedCount} inactive users with no message history.`);
        }
    } catch (error) {
        console.error("Error in cleanInactiveUsers job:", error);
    }
}

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    connectDB();   
    // Run cleanup on start and every 24 hours
    cleanInactiveUsers();
    setInterval(cleanInactiveUsers, 24 * 60 * 60 * 1000);
});   