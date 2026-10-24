import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  AskKnowledgeBaseBody,
  AskKnowledgeBaseResponse,
  DeleteDocumentParams,
  DeleteHistoryItemParams,
  GetAnalyticsQueryParams,
  GetAnalyticsResponse,
  GetConceptParams,
  GetConceptResponse,
  GetDashboardStatsResponse,
  GetDocumentPageParams,
  GetDocumentPageResponse,
  GetDocumentParams,
  GetDocumentResponse,
  GetHistoryItemParams,
  GetHistoryItemResponse,
  GetKnowledgeGraphQueryParams,
  GetKnowledgeGraphResponse,
  GetRelationshipParams,
  GetRelationshipResponse,
  ListDocumentsResponse,
  ListQuestionHistoryResponse,
  ListSourcesQueryParams,
  ListSourcesResponse,
  RegisterDocumentBody,
  RegisterDocumentResponse,
  SearchKnowledgeBaseQueryParams,
  SearchKnowledgeBaseResponse,
  SubmitAnswerFeedbackBody,
  SubmitAnswerFeedbackParams,
  SubmitAnswerFeedbackResponse,
} from "@workspace/api-zod";
import {
  db,
  documentsTable,
} from "@workspace/db";
import {
  Router,
  type IRouter,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import {
  deleteDocument,
  deleteHistoryItem,
  getAnalytics,
  getConceptDetails,
  getDashboardStats,
  getDocument,
  getDocumentPage,
  getHistoryItem,
  getKnowledgeGraph,
  getRelationshipDetails,
  listDocuments,
  listQuestionHistory,
  listSources,
  saveGroundedAnswer,
  searchKnowledgeBase,
  submitAnswerFeedback,
} from "../lib/graphmind-data";
import {
  createGroundedAnswer,
  GraphMindError,
  processPdfDocument,
  retrieveEvidence,
} from "../lib/graphmind-processing";
import { ObjectStorageService } from "../lib/objectStorage";
import { getObjectAclPolicy } from "../lib/objectAcl";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const OBJECT_PATH_PATTERN = /^\/objects\/uploads\/[0-9a-f-]{36}$/i;

type AsyncHandler = (req: Request, res: Response) => Promise<void>;

function safely(handler: AsyncHandler): RequestHandler {
  return async (req, res, _next): Promise<void> => {
    try {
      await handler(req, res);
    } catch (error) {
      if (res.headersSent) return;
      if (error instanceof GraphMindError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      req.log.error({ err: error }, "GraphMind request failed");
      res.status(500).json({ error: "The request could not be completed." });
    }
  };
}

function requireUser(req: Request, res: Response): string | null {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Please sign in to use your knowledge base." });
    return null;
  }
  return req.user.id;
}

function safePdfName(name: string): string {
  const leafName = name.split(/[\\/]/).pop() ?? "";
  return leafName.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 255);
}

router.get(
  "/dashboard/stats",
  safely(async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    res.json(GetDashboardStatsResponse.parse(await getDashboardStats(userId)));
  }),
);

router.get(
  "/documents",
  safely(async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    res.json(ListDocumentsResponse.parse(await listDocuments(userId)));
  }),
);

router.post(
  "/documents",
  safely(async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const parsed = RegisterDocumentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid document upload metadata." });
      return;
    }
    const { objectPath, sizeBytes, contentType } = parsed.data;
    const name = safePdfName(parsed.data.name);
    if (
      !name ||
      !name.toLowerCase().endsWith(".pdf") ||
      contentType !== "application/pdf" ||
      sizeBytes > MAX_PDF_BYTES ||
      !OBJECT_PATH_PATTERN.test(objectPath)
    ) {
      res.status(400).json({ error: "Only readable PDF files up to 20 MB are accepted." });
      return;
    }

    const [duplicate] = await db
      .select({ id: documentsTable.id })
      .from(documentsTable)
      .where(eq(documentsTable.objectPath, objectPath))
      .limit(1);
    if (duplicate) {
      res.status(409).json({ error: "This uploaded file has already been registered." });
      return;
    }

    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const [metadata] = await objectFile.getMetadata();
    const actualSize = Number(metadata.size ?? 0);
    if (
      actualSize < 1 ||
      actualSize > MAX_PDF_BYTES ||
      (metadata.contentType && metadata.contentType !== "application/pdf")
    ) {
      res.status(400).json({ error: "The uploaded object is not a valid PDF upload." });
      return;
    }
    const policy = await getObjectAclPolicy(objectFile);
    if (policy && policy.owner !== userId) {
      res.status(403).json({ error: "This uploaded file belongs to another account." });
      return;
    }
    await objectStorageService.trySetObjectEntityAclPolicy(objectPath, {
      owner: userId,
      visibility: "private",
    });

    const id = randomUUID();
    await db.insert(documentsTable).values({
      id,
      userId,
      name,
      sizeBytes: actualSize,
      contentType: "application/pdf",
      objectPath,
      status: "uploaded",
    });
    res
      .status(201)
      .json(RegisterDocumentResponse.parse(await getDocument(userId, id)));
  }),
);

router.get(
  "/documents/:documentId",
  safely(async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const params = GetDocumentParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid document identifier." });
      return;
    }
    res.json(
      GetDocumentResponse.parse(
        await getDocument(userId, params.data.documentId),
      ),
    );
  }),
);

router.delete(
  "/documents/:documentId",
  safely(async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const params = DeleteDocumentParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid document identifier." });
      return;
    }
    await deleteDocument(userId, params.data.documentId);
    res.sendStatus(204);
  }),
);

router.post(
  "/documents/:documentId/process",
  safely(async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const params = DeleteDocumentParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid document identifier." });
      return;
    }
    await processPdfDocument(userId, params.data.documentId);
    res.json(
      GetDocumentResponse.parse(
        await getDocument(userId, params.data.documentId),
      ),
    );
  }),
);

router.get(
  "/documents/:documentId/pages/:pageNumber",
  safely(async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const params = GetDocumentPageParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid document page." });
      return;
    }
    res.json(
      GetDocumentPageResponse.parse(
        await getDocumentPage(
          userId,
          params.data.documentId,
          params.data.pageNumber,
        ),
      ),
    );
  }),
);

router.post(
  "/chat/ask",
  safely(async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const parsed = AskKnowledgeBaseBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Enter a question of 2 to 4,000 characters." });
      return;
    }
    const documentIds = Array.from(new Set(parsed.data.documentIds ?? []));
    if (documentIds.length) {
      const owned = await db
        .select({ id: documentsTable.id })
        .from(documentsTable)
        .where(
          and(
            eq(documentsTable.userId, userId),
            inArray(documentsTable.id, documentIds),
          ),
        );
      if (owned.length !== documentIds.length) {
        res.status(400).json({ error: "One or more selected documents are unavailable." });
        return;
      }
    }
    const evidence = await retrieveEvidence(
      userId,
      parsed.data.question,
      documentIds,
    );
    const generated = await createGroundedAnswer(
      parsed.data.question,
      evidence,
    );
    const saved = await saveGroundedAnswer(
      userId,
      parsed.data.question,
      generated.answer,
      generated.mode,
      generated.evidenceUsed ? evidence : [],
    );
    res.json(AskKnowledgeBaseResponse.parse(saved));
  }),
);

router.get(
  "/chat/history",
  safely(async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    res.json(ListQuestionHistoryResponse.parse(await listQuestionHistory(userId)));
  }),
);

router.get(
  "/chat/history/:historyId",
  safely(async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const params = GetHistoryItemParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid history identifier." });
      return;
    }
    res.json(
      GetHistoryItemResponse.parse(
        await getHistoryItem(userId, params.data.historyId),
      ),
    );
  }),
);

router.delete(
  "/chat/history/:historyId",
  safely(async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const params = DeleteHistoryItemParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid history identifier." });
      return;
    }
    await deleteHistoryItem(userId, params.data.historyId);
    res.sendStatus(204);
  }),
);

router.post(
  "/chat/history/:historyId/feedback",
  safely(async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const params = SubmitAnswerFeedbackParams.safeParse(req.params);
    const body = SubmitAnswerFeedbackBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid answer feedback." });
      return;
    }
    res.json(
      SubmitAnswerFeedbackResponse.parse(
        await submitAnswerFeedback(
          userId,
          params.data.historyId,
          body.data.helpful,
        ),
      ),
    );
  }),
);

router.get(
  "/graph",
  safely(async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const params = GetKnowledgeGraphQueryParams.safeParse(req.query);
    if (!params.success) {
      res.status(400).json({ error: "Invalid graph filter." });
      return;
    }
    res.json(
      GetKnowledgeGraphResponse.parse(
        await getKnowledgeGraph(userId, params.data),
      ),
    );
  }),
);

router.get(
  "/graph/concepts/:conceptId",
  safely(async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const params = GetConceptParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid concept identifier." });
      return;
    }
    res.json(
      GetConceptResponse.parse(
        await getConceptDetails(userId, params.data.conceptId),
      ),
    );
  }),
);

router.get(
  "/graph/relationships/:relationshipId",
  safely(async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const params = GetRelationshipParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid relationship identifier." });
      return;
    }
    res.json(
      GetRelationshipResponse.parse(
        await getRelationshipDetails(userId, params.data.relationshipId),
      ),
    );
  }),
);

router.get(
  "/sources",
  safely(async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const params = ListSourcesQueryParams.safeParse(req.query);
    if (!params.success) {
      res.status(400).json({ error: "Invalid evidence filters." });
      return;
    }
    res.json(ListSourcesResponse.parse(await listSources(userId, params.data)));
  }),
);

router.get(
  "/analytics",
  safely(async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const params = GetAnalyticsQueryParams.safeParse(req.query);
    if (!params.success) {
      res.status(400).json({ error: "Invalid analytics range." });
      return;
    }
    res.json(
      GetAnalyticsResponse.parse(
        await getAnalytics(userId, params.data.range ?? "30d"),
      ),
    );
  }),
);

router.get(
  "/search",
  safely(async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    const params = SearchKnowledgeBaseQueryParams.safeParse(req.query);
    if (!params.success) {
      res.status(400).json({ error: "Enter a search term." });
      return;
    }
    res.json(
      SearchKnowledgeBaseResponse.parse(
        await searchKnowledgeBase(userId, params.data.query),
      ),
    );
  }),
);

export default router;
