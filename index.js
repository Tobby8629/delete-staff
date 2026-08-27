import {
  Client,
  Users,
  Databases,
} from "node-appwrite";

export default async ({ req, res }) => {
  try {
    const {
      staffId,
      userId,
    } = JSON.parse(req.body);

    if (!staffId || !userId) {
      return res.json(
        {
          success: false,
          message:
            "staffId and userId are required",
        },
        400
      );
    }

    const client = new Client()
      .setEndpoint(
        process.env.APPWRITE_ENDPOINT
      )
      .setProject(
        process.env.APPWRITE_PROJECT_ID
      )
      .setKey(
        process.env.APPWRITE_API_KEY
      );

    const users = new Users(client);
    const databases =
      new Databases(client);

    /**
     * Check that staff exists.
     */
    let staff;

    try {
      staff =
        await databases.getDocument(
          process.env.APPWRITE_DATABASE_ID,
          process.env.APPWRITE_STAFF_COLLECTION_ID,
          staffId
        );
    } catch (error) {
      if (error?.code === 404) {
        return res.json(
          {
            success: false,
            message:
              "Staff record not found",
          },
          404
        );
      }

      throw error;
    }

    if (staff.status === "inactive") {
      return res.json(
        {
          success: false,
          message:
            "Staff member is already inactive",
        },
        409
      );
    }

    await users.updateStatus(
      userId,
      false
    );


    const updatedStaff =
      await databases.updateDocument(
        process.env.APPWRITE_DATABASE_ID,
        process.env.APPWRITE_STAFF_COLLECTION_ID,
        staffId,
        {
          status: "inactive",
        }
      );

    return res.json({
      success: true,
      message:
        "Staff member deactivated successfully",
      data: updatedStaff,
    });

  } catch (error) {
    return res.json(
      {
        success: false,
        message:
          error?.message ||
          "Failed to deactivate staff member",
      },
      500
    );
  }
};