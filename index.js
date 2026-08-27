// import {
//   Client,
//   Users,
//   Databases,
// } from "node-appwrite";

// export default async ({ req, res }) => {
//   try {
//     const {
//       staffId,
//       userId,
//     } = JSON.parse(req.body);

//     if (!staffId || !userId) {
//       return res.json(
//         {
//           success: false,
//           message:
//             "staffId and userId are required",
//         },
//         400
//       );
//     }

//     const client = new Client()
//       .setEndpoint(
//         process.env.APPWRITE_ENDPOINT
//       )
//       .setProject(
//         process.env.APPWRITE_PROJECT_ID
//       )
//       .setKey(
//         process.env.APPWRITE_API_KEY
//       );

//     const users = new Users(client);
//     const databases =
//       new Databases(client);

//     /**
//      * Check that staff exists.
//      */
//     let staff;

//     try {
//       staff =
//         await databases.getDocument(
//           process.env.APPWRITE_DATABASE_ID,
//           process.env.APPWRITE_STAFF_COLLECTION_ID,
//           staffId
//         );
//     } catch (error) {
//       if (error?.code === 404) {
//         return res.json(
//           {
//             success: false,
//             message:
//               "Staff record not found",
//           },
//           404
//         );
//       }

//       throw error;
//     }

//     if (staff.status === "inactive") {
//       return res.json(
//         {
//           success: false,
//           message:
//             "Staff member is already inactive",
//         },
//         409
//       );
//     }

//     await users.updateStatus(
//       userId,
//       false
//     );


//     const updatedStaff =
//       await databases.updateDocument(
//         process.env.APPWRITE_DATABASE_ID,
//         process.env.APPWRITE_STAFF_COLLECTION_ID,
//         staffId,
//         {
//           status: "inactive",
//         }
//       );

//     return res.json({
//       success: true,
//       message:
//         "Staff member deactivated successfully",
//       data: updatedStaff,
//     });

//   } catch (error) {
//     return res.json(
//       {
//         success: false,
//         message:
//           error?.message ||
//           "Failed to deactivate staff member",
//       },
//       500
//     );
//   }
// };


import {
  Client,
  Users,
  Databases,
  Query,
  ID,
} from "node-appwrite";

export default async ({ req, res, error }) => {
  try {
    const {
      staffId,
      userId,
    } = JSON.parse(req.body);

    if (!staffId || !userId) {
      return res.json(
        {
          success: false,
          message: "staffId and userId are required",
        },
        400
      );
    }

    const client = new Client()
      .setEndpoint(process.env.APPWRITE_ENDPOINT)
      .setProject(process.env.APPWRITE_PROJECT_ID)
      .setKey(process.env.APPWRITE_API_KEY);

    const users = new Users(client);
    const databases = new Databases(client);

    const databaseId =
      process.env.APPWRITE_DATABASE_ID;

    const staffCollectionId =
      process.env.APPWRITE_STAFF_COLLECTION_ID;

    const assignmentCollectionId =
      process.env.APPWRITE_STAFF_SHIFT_ASSIGNMENT_COLLECTION_ID;

    const openShiftCollectionId =
      process.env.APPWRITE_OPEN_SHIFT_COLLECTION_ID;

    /**
     * YYYY-MM-DD in facility/local timezone.
     *
     * If your scheduling timezone is important,
     * you can later replace this with Luxon.
     */
    const now = new Date();

    const todayYMD = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-");

    /**
     * 1. Make sure staff exists.
     */
    let staff;

    try {
      staff = await databases.getDocument(
        databaseId,
        staffCollectionId,
        staffId
      );
    } catch (err) {
      if (err?.code === 404) {
        return res.json(
          {
            success: false,
            message: "Staff record not found",
          },
          404
        );
      }

      throw err;
    }

    /**
     * 2. Find this staff member's current/future assignments.
     */
    const assignmentResult =
      await databases.listDocuments(
        databaseId,
        assignmentCollectionId,
        [
          Query.equal("staffId", staffId),
          Query.greaterThanEqual(
            "dateYMD",
            todayYMD
          ),
          Query.limit(100),
        ]
      );

    const assignments =
      assignmentResult.documents || [];

    const convertedToOpenShift = [];
    const deletedAssignments = [];
    const failedAssignments = [];

    /**
     * 3. Convert each future assignment
     * into an open shift.
     */
    for (const assignment of assignments) {
      try {
        /**
         * Create open shift.
         *
         * Adjust these fields to match
         * YOUR open_shift collection.
         */
        const openShift =
          await databases.createDocument(
            databaseId,
            openShiftCollectionId,
            ID.unique(),
            {
              shiftId:
                assignment.shiftId,

              dateYMD:
                assignment.dateYMD,

              date:
                assignment.date,

              unitId:
                assignment.unitId,

              departmentId:
                assignment.departmentId,

              status:
                "open",

              source:
                "staff_deleted",

              originalAssignmentId:
                assignment.$id,

              originalStaffId:
                staffId,

              createdAt:
                new Date().toISOString(),
            }
          );

        convertedToOpenShift.push(
          openShift.$id
        );

        /**
         * 4. Remove original staff assignment
         * after the open shift has successfully
         * been created.
         */
        await databases.deleteDocument(
          databaseId,
          assignmentCollectionId,
          assignment.$id
        );

        deletedAssignments.push(
          assignment.$id
        );
      } catch (assignmentError) {
        failedAssignments.push({
          assignmentId:
            assignment.$id,

          message:
            assignmentError?.message ||
            "Failed to convert assignment",
        });
      }
    }

    /**
     * If any future assignments could not
     * be converted, I recommend NOT deleting
     * the staff member yet.
     *
     * Otherwise you could lose staffing data.
     */
    if (failedAssignments.length > 0) {
      return res.json(
        {
          success: false,
          message:
            "Some assigned shifts could not be converted to open shifts. Staff was not deleted.",
          data: {
            convertedToOpenShift,
            deletedAssignments,
            failedAssignments,
          },
        },
        409
      );
    }

    /**
     * 5. Delete staff database document.
     */
    await databases.deleteDocument(
      databaseId,
      staffCollectionId,
      staffId
    );

    /**
     * 6. Permanently delete Appwrite auth user.
     *
     * Do this last.
     */
    try {
      await users.delete(userId);
    } catch (userDeleteError) {
      /**
       * At this point the staff DB record
       * has already been removed, so return
       * a partial-success response.
       */
      return res.json(
        {
          success: false,
          partialSuccess: true,
          message:
            "Staff record and future assignments were removed, but the auth user could not be deleted.",
          error:
            userDeleteError?.message,
          data: {
            convertedToOpenShift,
            deletedAssignments,
          },
        },
        500
      );
    }

    return res.json({
      success: true,

      message:
        "Staff permanently deleted and future shifts converted to open shifts.",

      data: {
        deletedStaffId:
          staffId,

        deletedUserId:
          userId,

        assignmentsConverted:
          convertedToOpenShift.length,

        convertedToOpenShift,

        deletedAssignments,
      },
    });

  } catch (err) {
    error?.(
      `deleteStaff error: ${
        err?.message || err
      }`
    );

    return res.json(
      {
        success: false,
        message:
          err?.message ||
          "Failed to permanently delete staff",
      },
      500
    );
  }
};