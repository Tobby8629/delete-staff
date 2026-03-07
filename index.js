import { Client, Users, Databases } from "node-appwrite";

export default async ({ req, res }) => {
  try {
    const { staffId, userId } = JSON.parse(req.body);

    const client = new Client()
      .setEndpoint(process.env.APPWRITE_ENDPOINT)
      .setProject(process.env.APPWRITE_PROJECT_ID)
      .setKey(process.env.APPWRITE_API_KEY);

    const users = new Users(client);
    const databases = new Databases(client);

    // 1️⃣ Delete auth user
    await users.delete(userId);

    // 2️⃣ Delete staff document
    await databases.deleteDocument(
      process.env.APPWRITE_DATABASE_ID,
      process.env.APPWRITE_STAFF_COLLECTION_ID,
      staffId
    );

    return res.json({ success: true });

  } catch (error) {
    return res.json({ error: error.message }, 500);
  }
};