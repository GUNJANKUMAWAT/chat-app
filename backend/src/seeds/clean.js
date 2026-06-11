import { config } from "dotenv";
import { connectDB } from "../lib/db.js";
import User from "../models/user.model.js";

config();

const cleanDatabase = async () => {
  try {
    console.log("Connecting to database...");
    await connectDB();
    
    console.log("Querying and deleting static users (*@example.com)...");
    const result = await User.deleteMany({ email: { $regex: /@example\.com$/ } });
    
    console.log(`Success: Deleted ${result.deletedCount} static users.`);
    process.exit(0);
  } catch (error) {
    console.error("Failed to clean database:", error);
    process.exit(1);
  }
};

cleanDatabase();
