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
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : req.body || {};

    const {
      staffId,
      userId,
      actorUserId,
    } = body;

    if (!staffId || !userId || !actorUserId) {
      return res.json(
        {
          success: false,
          message:
            "staffId, userId and actorUserId are required",
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
      process.env
        .APPWRITE_STAFF_SHIFT_ASSIGNMENT_COLLECTION_ID;

    const openShiftCollectionId =
      process.env.APPWRITE_OPEN_SHIFT_COLLECTION_ID;

    if (
      !databaseId ||
      !staffCollectionId ||
      !assignmentCollectionId ||
      !openShiftCollectionId
    ) {
      return res.json(
        {
          success: false,
          message:
            "Required environment variables are missing",
        },
        500
      );
    }

    /**
     * Check staff exists.
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
     * Current date YYYY-MM-DD.
     */
    const now = new Date();

    const todayYMD = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-");

    /**
     * Get ALL current/future assignments.
     */
    const assignments = [];
    let cursor = null;

    while (true) {
      const queries = [
        Query.equal("staffId", staffId),
        Query.greaterThanEqual(
          "dateYMD",
          todayYMD
        ),
        Query.orderAsc("$id"),
        Query.limit(100),
      ];

      if (cursor) {
        queries.push(
          Query.cursorAfter(cursor)
        );
      }

      const result =
        await databases.listDocuments(
          databaseId,
          assignmentCollectionId,
          queries
        );

      assignments.push(
        ...result.documents
      );

      if (
        result.documents.length < 100
      ) {
        break;
      }

      cursor =
        result.documents[
          result.documents.length - 1
        ].$id;
    }

    /**
     * Validate ALL assignments before making
     * any database changes.
     */
    const invalidAssignments =
      assignments.filter(
        (assignment) =>
          !assignment.shiftId ||
          !assignment.date ||
          !assignment.dateYMD ||
          !assignment.departmentId
      );

    if (invalidAssignments.length > 0) {
      return res.json(
        {
          success: false,
          message:
            "Some future assignments are missing required information.",
          data: {
            invalidAssignments:
              invalidAssignments.map(
                (item) => ({
                  assignmentId:
                    item.$id,

                  shiftId:
                    item.shiftId || null,

                  date:
                    item.date || null,

                  dateYMD:
                    item.dateYMD || null,

                  departmentId:
                    item.departmentId ||
                    null,
                })
              ),
          },
        },
        409
      );
    }

    const createdOpenShifts = [];
    const deletedAssignments = [];

    /**
     * Create open shifts first.
     */
    try {
      for (const assignment of assignments) {
        const openShift =
          await databases.createDocument(
            databaseId,
            openShiftCollectionId,
            ID.unique(),
            {
              /**
               * Admin/system actor who caused
               * the open shift to be created.
               */
              createdBy:
                actorUserId,

              totalOpenings:
                1,

              filledCount:
                0,

              allowAvailabilityList:
                true,

              /**
               * Must exactly match your
               * Appwrite enum value.
               */
              status:
                "open",

              departmentId:
                assignment.departmentId,

              unitId:
                assignment.unitId || null,

              shiftId:
                assignment.shiftId,

              date:
                assignment.date,

              dateYMD:
                assignment.dateYMD,

              requiresLead:
                false,

              notes:
                "Automatically opened because assigned staff was permanently deleted",
            }
          );

        createdOpenShifts.push({
          openShiftId:
            openShift.$id,

          assignmentId:
            assignment.$id,
        });
      }
    } catch (createError) {
      /**
       * Roll back open shifts already created.
       */
      for (
        const created of
        createdOpenShifts
      ) {
        try {
          await databases.deleteDocument(
            databaseId,
            openShiftCollectionId,
            created.openShiftId
          );
        } catch {
          // Ignore rollback failure here.
        }
      }

      return res.json(
        {
          success: false,
          message:
            "Failed to convert future assignments to open shifts. Staff was not deleted.",
          error:
            createError?.message ||
            String(createError),
        },
        409
      );
    }

    /**
     * All open shifts were created successfully.
     *
     * Now remove corresponding assignments.
     */
    try {
      for (const assignment of assignments) {
        await databases.deleteDocument(
          databaseId,
          assignmentCollectionId,
          assignment.$id
        );

        deletedAssignments.push(
          assignment.$id
        );
      }
    } catch (deleteAssignmentError) {
      return res.json(
        {
          success: false,
          partialSuccess: true,
          message:
            "Open shifts were created, but one or more original assignments could not be deleted.",
          error:
            deleteAssignmentError?.message ||
            String(
              deleteAssignmentError
            ),
          data: {
            createdOpenShifts,
            deletedAssignments,
          },
        },
        500
      );
    }

    /**
     * Delete staff document.
     */
    await databases.deleteDocument(
      databaseId,
      staffCollectionId,
      staffId
    );

    /**
     * Permanently delete Appwrite Auth user.
     */
    try {
      await users.delete(userId);
    } catch (userDeleteError) {
      return res.json(
        {
          success: false,
          partialSuccess: true,
          message:
            "Staff record and future assignments were removed, but the Appwrite Auth user could not be deleted.",
          error:
            userDeleteError?.message ||
            String(userDeleteError),
          data: {
            createdOpenShifts,
            deletedAssignments,
          },
        },
        500
      );
    }

    return res.json({
      success: true,

      message:
        "Staff permanently deleted and future assignments converted to open shifts.",

      data: {
        deletedStaffId:
          staffId,

        deletedUserId:
          userId,

        futureAssignmentsFound:
          assignments.length,

        assignmentsConverted:
          createdOpenShifts.length,

        createdOpenShifts,

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