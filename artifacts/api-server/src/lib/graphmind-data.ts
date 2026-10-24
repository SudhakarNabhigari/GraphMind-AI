import {
  and,
  desc,
  eq,
  inArray,
  type SQL,
} from "drizzle-orm";
import {
  conceptsTable,
  conceptOccurrencesTable,
  db,
  documentChunksTable,
  documentsTable,
  questionsTable,
  questionSourcesTable,
  relationshipsTable,
} from "@workspace/db";
import { ObjectStorageService } from "./objectStorage";
import { GraphMindError, type RetrievedEvidence } from "./graphmind-processing";

export interface SourceFilters {
  search?: string;
  documentId?: string;
  concept?: string;
  historyId?: string;
}

export interface GraphFilters {
  documentId?: string;
  relationshipType?: string;
  search?: string;
}

export interface GraphNodeData {
  id: string;
  label: string;
  description: string | null;
  category: string;
  frequency: number;
  documentIds: string[];
  pages: number[];
}

export interface GraphRelationshipData {
  id: string;
  source: string;
  target: string;
  label: string;
  evidence: string;
  documentId: string;
  documentName: string;
  pageNumber: number;
}

export interface EvidenceSourceData {
  id: string;
  documentId: string;
  documentName: string;
  pageNumber: number;
  passage: string;
  relevance: number;
  concept: string | null;
  historyId: string | null;
  referencedAt: Date | null;
}

export interface HistoryItemData {
  id: string;
  question: string;
  answer: string;
  createdAt: Date;
  sources: EvidenceSourceData[];
  documentNames: string[];
  helpful: boolean | null;
  mode: "ai" | "demo";
}

const objectStorageService = new ObjectStorageService();

function countConceptsByDocument(
  rows: Array<{ documentId: string; conceptId: string }>,
): Map<string, Set<string>> {
  const counts = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = counts.get(row.documentId) ?? new Set<string>();
    set.add(row.conceptId);
    counts.set(row.documentId, set);
  }
  return counts;
}

function toDocumentResponse(
  row: typeof documentsTable.$inferSelect,
  conceptsCount: number,
) {
  return {
    id: row.id,
    name: row.name,
    sizeBytes: row.sizeBytes,
    pageCount: row.pageCount,
    status: row.status as "uploaded" | "processing" | "processed" | "failed",
    statusMessage: row.statusMessage,
    uploadedAt: row.uploadedAt,
    processedAt: row.processedAt,
    extractedTextAvailable: row.extractedTextAvailable,
    conceptsCount,
    objectPath: row.objectPath,
  };
}

export async function listDocuments(userId: string) {
  const rows = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.userId, userId))
    .orderBy(desc(documentsTable.uploadedAt));
  const occurrences = rows.length
    ? await db
        .select({
          documentId: conceptOccurrencesTable.documentId,
          conceptId: conceptOccurrencesTable.conceptId,
        })
        .from(conceptOccurrencesTable)
        .innerJoin(
          documentsTable,
          eq(conceptOccurrencesTable.documentId, documentsTable.id),
        )
        .where(eq(documentsTable.userId, userId))
    : [];
  const counts = countConceptsByDocument(occurrences);
  return rows.map((row) =>
    toDocumentResponse(row, counts.get(row.id)?.size ?? 0),
  );
}

export async function getDocument(userId: string, documentId: string) {
  const row = await db
    .select()
    .from(documentsTable)
    .where(and(eq(documentsTable.id, documentId), eq(documentsTable.userId, userId)))
    .limit(1);
  const document = row[0];
  if (!document) throw new GraphMindError("Document not found.", 404);
  const [occurrences, chunks] = await Promise.all([
    db
      .select({ conceptId: conceptOccurrencesTable.conceptId })
      .from(conceptOccurrencesTable)
      .where(eq(conceptOccurrencesTable.documentId, documentId)),
    db
      .select({ id: documentChunksTable.id })
      .from(documentChunksTable)
      .where(eq(documentChunksTable.documentId, documentId))
      .limit(1),
  ]);
  return {
    ...toDocumentResponse(
      document,
      new Set(occurrences.map((item) => item.conceptId)).size,
    ),
    extractedTextAvailable: document.extractedTextAvailable && chunks.length > 0,
  };
}

export async function getDocumentPage(
  userId: string,
  documentId: string,
  pageNumber: number,
) {
  const [document] = await db
    .select({
      id: documentsTable.id,
      name: documentsTable.name,
      status: documentsTable.status,
    })
    .from(documentsTable)
    .where(and(eq(documentsTable.id, documentId), eq(documentsTable.userId, userId)))
    .limit(1);
  if (!document) throw new GraphMindError("Document not found.", 404);
  const chunks = await db
    .select({
      id: documentChunksTable.id,
      documentId: documentsTable.id,
      documentName: documentsTable.name,
      pageNumber: documentChunksTable.pageNumber,
      passage: documentChunksTable.content,
    })
    .from(documentChunksTable)
    .innerJoin(
      documentsTable,
      eq(documentChunksTable.documentId, documentsTable.id),
    )
    .where(
      and(
        eq(documentsTable.userId, userId),
        eq(documentsTable.id, documentId),
        eq(documentChunksTable.pageNumber, pageNumber),
      ),
    )
    .orderBy(documentChunksTable.chunkIndex);
  if (!chunks.length) throw new GraphMindError("Page evidence not found.", 404);

  const conceptRows = await db
    .select({
      chunkId: conceptOccurrencesTable.chunkId,
      label: conceptsTable.label,
    })
    .from(conceptOccurrencesTable)
    .innerJoin(conceptsTable, eq(conceptOccurrencesTable.conceptId, conceptsTable.id))
    .where(eq(conceptOccurrencesTable.documentId, documentId));
  const conceptsByChunk = new Map<string, string>();
  for (const row of conceptRows) {
    if (!conceptsByChunk.has(row.chunkId)) conceptsByChunk.set(row.chunkId, row.label);
  }

  return {
    documentId: document.id,
    documentName: document.name,
    pageNumber,
    passages: chunks.map((chunk) => ({
      id: chunk.id,
      documentId: chunk.documentId,
      documentName: chunk.documentName,
      pageNumber: chunk.pageNumber,
      passage: chunk.passage,
      relevance: 1,
      concept: conceptsByChunk.get(chunk.id) ?? null,
      historyId: null,
      referencedAt: null,
    })),
  };
}

export async function deleteDocument(
  userId: string,
  documentId: string,
): Promise<void> {
  const [document] = await db
    .select()
    .from(documentsTable)
    .where(and(eq(documentsTable.id, documentId), eq(documentsTable.userId, userId)))
    .limit(1);
  if (!document) throw new GraphMindError("Document not found.", 404);

  try {
    const file = await objectStorageService.getObjectEntityFile(document.objectPath);
    await file.delete({ ignoreNotFound: true });
  } catch (error) {
    if (!(error instanceof Error && error.name === "ObjectNotFoundError")) {
      throw new GraphMindError("The stored PDF could not be deleted. Please retry.", 500);
    }
  }

  await db.delete(documentsTable).where(eq(documentsTable.id, documentId));
  const concepts = await db
    .select({ id: conceptsTable.id })
    .from(conceptsTable)
    .where(eq(conceptsTable.userId, userId));
  for (const concept of concepts) {
    const [occurrence] = await db
      .select({ id: conceptOccurrencesTable.id })
      .from(conceptOccurrencesTable)
      .where(eq(conceptOccurrencesTable.conceptId, concept.id))
      .limit(1);
    if (!occurrence) {
      await db
        .delete(conceptsTable)
        .where(and(eq(conceptsTable.id, concept.id), eq(conceptsTable.userId, userId)));
    }
  }
}

export async function getDashboardStats(userId: string) {
  const [documents, questions, concepts, relationships] = await Promise.all([
    db.select().from(documentsTable).where(eq(documentsTable.userId, userId)),
    db.select({ id: questionsTable.id }).from(questionsTable).where(eq(questionsTable.userId, userId)),
    db
      .select({ id: conceptsTable.id })
      .from(conceptsTable)
      .innerJoin(
        conceptOccurrencesTable,
        eq(conceptOccurrencesTable.conceptId, conceptsTable.id),
      )
      .where(eq(conceptsTable.userId, userId)),
    db
      .select({ id: relationshipsTable.id })
      .from(relationshipsTable)
      .where(eq(relationshipsTable.userId, userId)),
  ]);
  const uniqueConceptIds = new Set(concepts.map((concept) => concept.id));
  return {
    documentsUploaded: documents.length,
    questionsAsked: questions.length,
    conceptsExtracted: uniqueConceptIds.size,
    connectionsFound: relationships.length,
    processedDocuments: documents.filter((doc) => doc.status === "processed").length,
    failedDocuments: documents.filter((doc) => doc.status === "failed").length,
  };
}

export async function makeHistoryItems(
  questions: Array<typeof questionsTable.$inferSelect>,
): Promise<HistoryItemData[]> {
  if (!questions.length) return [];
  const questionIds = questions.map((question) => question.id);
  const sources = await db
    .select()
    .from(questionSourcesTable)
    .where(inArray(questionSourcesTable.questionId, questionIds));
  const sourcesByQuestion = new Map<string, EvidenceSourceData[]>();
  for (const source of sources) {
    const items = sourcesByQuestion.get(source.questionId) ?? [];
    items.push({
      id: source.id,
      documentId: source.documentId,
      documentName: source.documentName,
      pageNumber: source.pageNumber,
      passage: source.passage,
      relevance: source.relevance,
      concept: null,
      historyId: source.questionId,
      referencedAt:
        questions.find((question) => question.id === source.questionId)?.createdAt ??
        null,
    });
    sourcesByQuestion.set(source.questionId, items);
  }

  return questions.map((question) => {
    const itemSources = sourcesByQuestion.get(question.id) ?? [];
    return {
      id: question.id,
      question: question.question,
      answer: question.answer,
      createdAt: question.createdAt,
      sources: itemSources,
      documentNames: Array.from(new Set(itemSources.map((source) => source.documentName))),
      helpful: question.helpful,
      mode: question.mode === "ai" ? "ai" : "demo",
    };
  });
}

export async function listQuestionHistory(userId: string) {
  const rows = await db
    .select()
    .from(questionsTable)
    .where(eq(questionsTable.userId, userId))
    .orderBy(desc(questionsTable.createdAt))
    .limit(100);
  return makeHistoryItems(rows);
}

export async function getHistoryItem(userId: string, historyId: string) {
  const [question] = await db
    .select()
    .from(questionsTable)
    .where(and(eq(questionsTable.id, historyId), eq(questionsTable.userId, userId)))
    .limit(1);
  if (!question) throw new GraphMindError("Question history not found.", 404);
  return (await makeHistoryItems([question]))[0];
}

export async function deleteHistoryItem(
  userId: string,
  historyId: string,
): Promise<void> {
  const [deleted] = await db
    .delete(questionsTable)
    .where(and(eq(questionsTable.id, historyId), eq(questionsTable.userId, userId)))
    .returning({ id: questionsTable.id });
  if (!deleted) throw new GraphMindError("Question history not found.", 404);
}

export async function submitAnswerFeedback(
  userId: string,
  historyId: string,
  helpful: boolean,
) {
  const [question] = await db
    .update(questionsTable)
    .set({ helpful })
    .where(and(eq(questionsTable.id, historyId), eq(questionsTable.userId, userId)))
    .returning({ id: questionsTable.id });
  if (!question) throw new GraphMindError("Question history not found.", 404);
  return { success: true, helpful };
}

export async function saveGroundedAnswer(
  userId: string,
  question: string,
  answer: string,
  mode: "ai" | "demo",
  sources: RetrievedEvidence[],
) {
  const id = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(questionsTable).values({
      id,
      userId,
      question,
      answer,
      mode,
    });
    if (sources.length) {
      await tx.insert(questionSourcesTable).values(
        sources.map((source) => ({
          id: crypto.randomUUID(),
          questionId: id,
          chunkId: source.id,
          documentId: source.documentId,
          documentName: source.documentName,
          pageNumber: source.pageNumber,
          passage: source.passage,
          relevance: source.relevance,
        })),
      );
    }
  });
  return getHistoryItem(userId, id);
}

export async function listSources(
  userId: string,
  filters: SourceFilters = {},
): Promise<EvidenceSourceData[]> {
  const needle = filters.search?.toLowerCase().trim();
  if (filters.historyId) {
    const [question] = await db
      .select({ id: questionsTable.id })
      .from(questionsTable)
      .where(
        and(
          eq(questionsTable.id, filters.historyId),
          eq(questionsTable.userId, userId),
        ),
      )
      .limit(1);
    if (!question) throw new GraphMindError("Question history not found.", 404);
    const savedSources = await db
      .select()
      .from(questionSourcesTable)
      .where(eq(questionSourcesTable.questionId, filters.historyId));
    const [questionRow] = await db
      .select({ createdAt: questionsTable.createdAt })
      .from(questionsTable)
      .where(eq(questionsTable.id, filters.historyId))
      .limit(1);
    return savedSources
      .filter(
        (source) =>
          (!filters.documentId || source.documentId === filters.documentId) &&
          (!needle ||
            source.documentName.toLowerCase().includes(needle) ||
            source.passage.toLowerCase().includes(needle)),
      )
      .map((source) => ({
        id: source.id,
        documentId: source.documentId,
        documentName: source.documentName,
        pageNumber: source.pageNumber,
        passage: source.passage,
        relevance: source.relevance,
        concept: null,
        historyId: filters.historyId ?? null,
        referencedAt: questionRow?.createdAt ?? null,
      }));
  }

  const conditions: SQL[] = [eq(documentsTable.userId, userId)];
  if (filters.documentId) {
    conditions.push(eq(documentsTable.id, filters.documentId));
  }
  const rows = await db
    .select({
      id: documentChunksTable.id,
      documentId: documentsTable.id,
      documentName: documentsTable.name,
      pageNumber: documentChunksTable.pageNumber,
      passage: documentChunksTable.content,
    })
    .from(documentChunksTable)
    .innerJoin(
      documentsTable,
      eq(documentChunksTable.documentId, documentsTable.id),
    )
    .where(and(...conditions))
    .orderBy(desc(documentChunksTable.createdAt))
    .limit(1000);
  const matchingRows = rows.filter(
    (row) =>
      (!needle ||
        row.documentName.toLowerCase().includes(needle) ||
        row.passage.toLowerCase().includes(needle)) &&
      (!filters.concept ||
        row.passage.toLowerCase().includes(filters.concept.toLowerCase())),
  );
  if (!matchingRows.length) return [];

  const chunkIds = matchingRows.map((row) => row.id);
  const [conceptRows, referenceRows] = await Promise.all([
    db
      .select({
        chunkId: conceptOccurrencesTable.chunkId,
        concept: conceptsTable.label,
      })
      .from(conceptOccurrencesTable)
      .innerJoin(conceptsTable, eq(conceptOccurrencesTable.conceptId, conceptsTable.id))
      .where(inArray(conceptOccurrencesTable.chunkId, chunkIds)),
    db
      .select({
        chunkId: questionSourcesTable.chunkId,
        historyId: questionsTable.id,
        referencedAt: questionsTable.createdAt,
      })
      .from(questionSourcesTable)
      .innerJoin(
        questionsTable,
        eq(questionSourcesTable.questionId, questionsTable.id),
      )
      .where(eq(questionsTable.userId, userId)),
  ]);
  const conceptByChunk = new Map<string, string>();
  for (const row of conceptRows) {
    if (!conceptByChunk.has(row.chunkId)) conceptByChunk.set(row.chunkId, row.concept);
  }
  const referenceByChunk = new Map<
    string,
    { historyId: string; referencedAt: Date }
  >();
  for (const row of referenceRows) {
    if (!referenceByChunk.has(row.chunkId)) {
      referenceByChunk.set(row.chunkId, {
        historyId: row.historyId,
        referencedAt: row.referencedAt,
      });
    }
  }
  return matchingRows.map((row) => ({
    id: row.id,
    documentId: row.documentId,
    documentName: row.documentName,
    pageNumber: row.pageNumber,
    passage: row.passage,
    relevance: 1,
    concept: conceptByChunk.get(row.id) ?? null,
    historyId: referenceByChunk.get(row.id)?.historyId ?? null,
    referencedAt: referenceByChunk.get(row.id)?.referencedAt ?? null,
  }));
}

export async function getKnowledgeGraph(
  userId: string,
  filters: GraphFilters = {},
) {
  const occurrenceConditions: SQL[] = [eq(documentsTable.userId, userId)];
  const relationshipConditions: SQL[] = [eq(relationshipsTable.userId, userId)];
  if (filters.documentId) {
    occurrenceConditions.push(eq(documentsTable.id, filters.documentId));
    relationshipConditions.push(eq(relationshipsTable.documentId, filters.documentId));
  }
  if (filters.relationshipType) {
    relationshipConditions.push(eq(relationshipsTable.label, filters.relationshipType));
  }
  const [conceptRows, occurrenceRows, relationshipRows] = await Promise.all([
    db.select().from(conceptsTable).where(eq(conceptsTable.userId, userId)),
    db
      .select({
        conceptId: conceptOccurrencesTable.conceptId,
        documentId: documentsTable.id,
        pageNumber: conceptOccurrencesTable.pageNumber,
      })
      .from(conceptOccurrencesTable)
      .innerJoin(
        documentsTable,
        eq(conceptOccurrencesTable.documentId, documentsTable.id),
      )
      .where(and(...occurrenceConditions)),
    db
      .select()
      .from(relationshipsTable)
      .where(and(...relationshipConditions)),
  ]);
  const occurrencesByConcept = new Map<
    string,
    { documentIds: Set<string>; pages: Set<number>; frequency: number }
  >();
  for (const occurrence of occurrenceRows) {
    const existing = occurrencesByConcept.get(occurrence.conceptId) ?? {
      documentIds: new Set<string>(),
      pages: new Set<number>(),
      frequency: 0,
    };
    existing.documentIds.add(occurrence.documentId);
    existing.pages.add(occurrence.pageNumber);
    existing.frequency += 1;
    occurrencesByConcept.set(occurrence.conceptId, existing);
  }
  const allNodes: GraphNodeData[] = conceptRows
    .filter((concept) => occurrencesByConcept.has(concept.id))
    .map((concept) => {
      const data = occurrencesByConcept.get(concept.id)!;
      return {
        id: concept.id,
        label: concept.label,
        description: null,
        category: concept.category,
        frequency: data.frequency,
        documentIds: Array.from(data.documentIds),
        pages: Array.from(data.pages).sort((a, b) => a - b),
      };
    });
  const visibleNodeIds = new Set(
    filters.search
      ? allNodes
          .filter((node) =>
            node.label.toLowerCase().includes(filters.search!.toLowerCase()),
          )
          .map((node) => node.id)
      : allNodes.map((node) => node.id),
  );
  const visibleNodes = filters.search
    ? allNodes.filter((node) => visibleNodeIds.has(node.id))
    : allNodes;
  const relatedConceptIds = new Set<string>();
  for (const relationship of relationshipRows) {
    if (
      visibleNodeIds.has(relationship.sourceConceptId) ||
      visibleNodeIds.has(relationship.targetConceptId)
    ) {
      relatedConceptIds.add(relationship.sourceConceptId);
      relatedConceptIds.add(relationship.targetConceptId);
    }
  }
  const nodeById = new Map(allNodes.map((node) => [node.id, node]));
  const edgeDocumentIds = Array.from(
    new Set(relationshipRows.map((relationship) => relationship.documentId)),
  );
  const edgeDocuments = edgeDocumentIds.length
    ? await db
        .select({ id: documentsTable.id, name: documentsTable.name })
        .from(documentsTable)
        .where(inArray(documentsTable.id, edgeDocumentIds))
    : [];
  const documentNameById = new Map(edgeDocuments.map((doc) => [doc.id, doc.name]));
  const edges: GraphRelationshipData[] = relationshipRows
    .filter(
      (relationship) =>
        relatedConceptIds.has(relationship.sourceConceptId) &&
        relatedConceptIds.has(relationship.targetConceptId),
    )
    .map((relationship) => ({
      id: relationship.id,
      source: relationship.sourceConceptId,
      target: relationship.targetConceptId,
      label: relationship.label,
      evidence: relationship.evidence,
      documentId: relationship.documentId,
      documentName: documentNameById.get(relationship.documentId) ?? "Deleted document",
      pageNumber: relationship.pageNumber,
    }));
  const edgeNodeIds = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
  const nodes =
    filters.search && edges.length
      ? allNodes.filter((node) => edgeNodeIds.has(node.id))
      : visibleNodes;
  return { nodes, edges, isExample: false };
}

export async function getConceptDetails(userId: string, conceptId: string) {
  const graph = await getKnowledgeGraph(userId);
  const concept = graph.nodes.find((node) => node.id === conceptId);
  if (!concept) throw new GraphMindError("Concept not found.", 404);
  const [occurrences, relationships] = await Promise.all([
    db
      .select({
        id: documentChunksTable.id,
        documentId: documentsTable.id,
        documentName: documentsTable.name,
        pageNumber: conceptOccurrencesTable.pageNumber,
        passage: conceptOccurrencesTable.evidence,
      })
      .from(conceptOccurrencesTable)
      .innerJoin(
        documentsTable,
        eq(conceptOccurrencesTable.documentId, documentsTable.id),
      )
      .innerJoin(
        documentChunksTable,
        eq(conceptOccurrencesTable.chunkId, documentChunksTable.id),
      )
      .where(
        and(
          eq(conceptOccurrencesTable.conceptId, conceptId),
          eq(documentsTable.userId, userId),
        ),
      ),
    db
      .select()
      .from(relationshipsTable)
      .where(eq(relationshipsTable.userId, userId)),
  ]);
  const relevantRelationships = relationships.filter(
    (item) =>
      item.sourceConceptId === conceptId || item.targetConceptId === conceptId,
  );
  const docs = relevantRelationships.length
    ? await db
        .select({ id: documentsTable.id, name: documentsTable.name })
        .from(documentsTable)
        .where(
          inArray(
            documentsTable.id,
            Array.from(new Set(relevantRelationships.map((item) => item.documentId))),
          ),
        )
    : [];
  const names = new Map(docs.map((doc) => [doc.id, doc.name]));
  return {
    concept,
    relationships: relevantRelationships.map((item) => ({
      id: item.id,
      source: item.sourceConceptId,
      target: item.targetConceptId,
      label: item.label,
      evidence: item.evidence,
      documentId: item.documentId,
      documentName: names.get(item.documentId) ?? "Deleted document",
      pageNumber: item.pageNumber,
    })),
    sources: occurrences.map((item) => ({
      id: item.id,
      documentId: item.documentId,
      documentName: item.documentName,
      pageNumber: item.pageNumber,
      passage: item.passage,
      relevance: 1,
      concept: concept.label,
      historyId: null,
      referencedAt: null,
    })),
  };
}

export async function getRelationshipDetails(
  userId: string,
  relationshipId: string,
) {
  const [relationship] = await db
    .select()
    .from(relationshipsTable)
    .where(
      and(
        eq(relationshipsTable.id, relationshipId),
        eq(relationshipsTable.userId, userId),
      ),
    )
    .limit(1);
  if (!relationship) throw new GraphMindError("Relationship not found.", 404);
  const concepts = await db
    .select({ id: conceptsTable.id, label: conceptsTable.label })
    .from(conceptsTable)
    .where(
      inArray(conceptsTable.id, [
        relationship.sourceConceptId,
        relationship.targetConceptId,
      ]),
    );
  const documents = await db
    .select({ id: documentsTable.id, name: documentsTable.name })
    .from(documentsTable)
    .where(eq(documentsTable.id, relationship.documentId));
  return {
    id: relationship.id,
    source: relationship.sourceConceptId,
    target: relationship.targetConceptId,
    label: relationship.label,
    evidence: relationship.evidence,
    documentId: relationship.documentId,
    documentName: documents[0]?.name ?? "Deleted document",
    pageNumber: relationship.pageNumber,
    sourceLabel: concepts.find((item) => item.id === relationship.sourceConceptId)?.label,
    targetLabel: concepts.find((item) => item.id === relationship.targetConceptId)?.label,
  };
}

export async function getAnalytics(userId: string, range = "30d") {
  const [stats, documents, questions, occurrences, sources, graphHistory] =
    await Promise.all([
      getDashboardStats(userId),
      db.select().from(documentsTable).where(eq(documentsTable.userId, userId)),
      db
        .select()
        .from(questionsTable)
        .where(eq(questionsTable.userId, userId))
        .orderBy(questionsTable.createdAt),
      db
        .select({
          conceptId: conceptOccurrencesTable.conceptId,
          documentId: conceptOccurrencesTable.documentId,
          createdAt: conceptOccurrencesTable.createdAt,
          label: conceptsTable.label,
        })
        .from(conceptOccurrencesTable)
        .innerJoin(
          conceptsTable,
          eq(conceptOccurrencesTable.conceptId, conceptsTable.id),
        )
        .where(eq(conceptsTable.userId, userId)),
      db
        .select({
          documentId: questionSourcesTable.documentId,
          documentName: questionSourcesTable.documentName,
        })
        .from(questionSourcesTable)
        .innerJoin(
          questionsTable,
          eq(questionSourcesTable.questionId, questionsTable.id),
        )
        .where(eq(questionsTable.userId, userId)),
      db
        .select({
          conceptId: conceptOccurrencesTable.conceptId,
          createdAt: conceptOccurrencesTable.createdAt,
        })
        .from(conceptOccurrencesTable)
        .innerJoin(
          conceptsTable,
          eq(conceptOccurrencesTable.conceptId, conceptsTable.id),
        )
        .where(eq(conceptsTable.userId, userId)),
    ]);

  const days = range === "7d" ? 7 : range === "30d" ? 30 : null;
  const cutoff = days
    ? new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    : null;
  const inRange = <T extends { createdAt: Date }>(items: T[]) =>
    cutoff ? items.filter((item) => item.createdAt >= cutoff) : items;
  const groupByDate = (items: Array<{ createdAt: Date }>) => {
    const counts = new Map<string, number>();
    for (const item of items) {
      const date = item.createdAt.toISOString().slice(0, 10);
      counts.set(date, (counts.get(date) ?? 0) + 1);
    }
    return Array.from(counts, ([date, count]) => ({ date, count })).sort((a, b) =>
      a.date.localeCompare(b.date),
    );
  };
  const questionRows = inRange(questions);
  const graphRows = inRange(graphHistory);
  const conceptCounts = new Map<string, number>();
  for (const occurrence of occurrences) {
    conceptCounts.set(
      occurrence.label,
      (conceptCounts.get(occurrence.label) ?? 0) + 1,
    );
  }
  const documentCitationCounts = new Map<string, number>();
  for (const source of sources) {
    documentCitationCounts.set(
      source.documentName,
      (documentCitationCounts.get(source.documentName) ?? 0) + 1,
    );
  }
  const distinctConceptsByDate = new Map<string, Set<string>>();
  for (const row of graphRows) {
    const date = row.createdAt.toISOString().slice(0, 10);
    const conceptsForDate = distinctConceptsByDate.get(date) ?? new Set<string>();
    conceptsForDate.add(row.conceptId);
    distinctConceptsByDate.set(date, conceptsForDate);
  }
  return {
    stats,
    questionsByDate: groupByDate(questionRows),
    topConcepts: Array.from(conceptCounts, ([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
    topDocuments: Array.from(documentCitationCounts, ([label, count]) => ({
      label,
      count,
    }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
    processingBreakdown: ["processed", "processing", "uploaded", "failed"].map(
      (status) => ({
        status,
        count: documents.filter((document) => document.status === status).length,
      }),
    ),
    graphGrowth: Array.from(distinctConceptsByDate, ([date, conceptsForDate]) => ({
      date,
      count: conceptsForDate.size,
    })).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export async function searchKnowledgeBase(userId: string, query: string) {
  const needle = query.toLowerCase().trim();
  if (!needle) return { documents: [], concepts: [], questions: [], sources: [] };
  const [documents, concepts, questions, sources] = await Promise.all([
    listDocuments(userId),
    getKnowledgeGraph(userId),
    listQuestionHistory(userId),
    listSources(userId, { search: needle }),
  ]);
  return {
    documents: documents
      .filter((document) => document.name.toLowerCase().includes(needle))
      .slice(0, 8),
    concepts: concepts.nodes
      .filter((concept) => concept.label.toLowerCase().includes(needle))
      .slice(0, 8),
    questions: questions
      .filter(
        (item) =>
          item.question.toLowerCase().includes(needle) ||
          item.answer.toLowerCase().includes(needle),
      )
      .slice(0, 8),
    sources: sources.slice(0, 8),
  };
}
