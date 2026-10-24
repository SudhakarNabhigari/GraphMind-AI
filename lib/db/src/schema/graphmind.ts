import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export const documentsTable = pgTable(
  "graphmind_documents",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    contentType: varchar("content_type", { length: 100 }).notNull(),
    objectPath: text("object_path").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("uploaded"),
    statusMessage: text("status_message"),
    pageCount: integer("page_count"),
    extractedTextAvailable: boolean("extracted_text_available")
      .notNull()
      .default(false),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [
    index("graphmind_documents_user_uploaded_idx").on(
      table.userId,
      table.uploadedAt,
    ),
  ],
);

export const documentChunksTable = pgTable(
  "graphmind_document_chunks",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    documentId: varchar("document_id")
      .notNull()
      .references(() => documentsTable.id, { onDelete: "cascade" }),
    pageNumber: integer("page_number").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("graphmind_chunks_document_page_idx").on(
      table.documentId,
      table.pageNumber,
    ),
  ],
);

export const conceptsTable = pgTable(
  "graphmind_concepts",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    label: varchar("label", { length: 160 }).notNull(),
    normalizedLabel: varchar("normalized_label", { length: 160 }).notNull(),
    category: varchar("category", { length: 60 }).notNull().default("Concept"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("graphmind_concepts_user_label_idx").on(
      table.userId,
      table.normalizedLabel,
    ),
  ],
);

export const conceptOccurrencesTable = pgTable(
  "graphmind_concept_occurrences",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    conceptId: varchar("concept_id")
      .notNull()
      .references(() => conceptsTable.id, { onDelete: "cascade" }),
    documentId: varchar("document_id")
      .notNull()
      .references(() => documentsTable.id, { onDelete: "cascade" }),
    chunkId: varchar("chunk_id")
      .notNull()
      .references(() => documentChunksTable.id, { onDelete: "cascade" }),
    pageNumber: integer("page_number").notNull(),
    evidence: text("evidence").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("graphmind_concept_occurrence_once_idx").on(
      table.conceptId,
      table.chunkId,
    ),
    index("graphmind_concept_occurrences_doc_idx").on(table.documentId),
  ],
);

export const relationshipsTable = pgTable(
  "graphmind_relationships",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    sourceConceptId: varchar("source_concept_id")
      .notNull()
      .references(() => conceptsTable.id, { onDelete: "cascade" }),
    targetConceptId: varchar("target_concept_id")
      .notNull()
      .references(() => conceptsTable.id, { onDelete: "cascade" }),
    documentId: varchar("document_id")
      .notNull()
      .references(() => documentsTable.id, { onDelete: "cascade" }),
    chunkId: varchar("chunk_id")
      .notNull()
      .references(() => documentChunksTable.id, { onDelete: "cascade" }),
    label: varchar("label", { length: 80 }).notNull(),
    evidence: text("evidence").notNull(),
    pageNumber: integer("page_number").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("graphmind_relationship_once_idx").on(
      table.sourceConceptId,
      table.targetConceptId,
      table.chunkId,
    ),
    index("graphmind_relationships_user_idx").on(table.userId),
  ],
);

export const questionsTable = pgTable(
  "graphmind_questions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    mode: varchar("mode", { length: 12 }).notNull(),
    helpful: boolean("helpful"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("graphmind_questions_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
  ],
);

export const questionSourcesTable = pgTable(
  "graphmind_question_sources",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    questionId: varchar("question_id")
      .notNull()
      .references(() => questionsTable.id, { onDelete: "cascade" }),
    chunkId: varchar("chunk_id").notNull(),
    documentId: varchar("document_id").notNull(),
    documentName: varchar("document_name", { length: 255 }).notNull(),
    pageNumber: integer("page_number").notNull(),
    passage: text("passage").notNull(),
    relevance: doublePrecision("relevance").notNull(),
  },
  (table) => [
    index("graphmind_question_sources_question_idx").on(table.questionId),
    index("graphmind_question_sources_document_idx").on(table.documentId),
  ],
);
