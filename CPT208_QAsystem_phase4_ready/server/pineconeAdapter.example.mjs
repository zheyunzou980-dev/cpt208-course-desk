/*
  Production adapter example.

  Install in a backend project:
    npm install @pinecone-database/pinecone openai

  Required environment variables:
    OPENAI_API_KEY
    PINECONE_API_KEY
    PINECONE_INDEX
*/

import OpenAI from "openai";
import { Pinecone } from "@pinecone-database/pinecone";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pinecone.index(process.env.PINECONE_INDEX);

const EMBEDDING_MODEL = "text-embedding-3-small";

export async function embedText(text) {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });
  return response.data[0].embedding;
}

export async function upsertQaItem(item) {
  const values = await embedText(`${item.question}\n\n${item.answer}`);

  await index.upsert([
    {
      id: item.id,
      values,
      metadata: {
        question: item.question,
        answer: item.answer,
        status: item.status,
        source: item.source,
        source_document: item.source_document,
        source_year: item.source_year,
        tags: item.tags || [],
      },
    },
  ]);
}

export async function searchApprovedQa(query, topK = 5) {
  const vector = await embedText(query);
  const result = await index.query({
    vector,
    topK,
    includeMetadata: true,
    filter: {
      status: { $eq: "approved" },
    },
  });

  return result.matches.map((match) => ({
    id: match.id,
    score: match.score,
    question: match.metadata.question,
    answer: match.metadata.answer,
    source_document: match.metadata.source_document,
    source_year: match.metadata.source_year,
    tags: match.metadata.tags,
  }));
}

export async function answerWithRetrievedQa(question) {
  const hits = await searchApprovedQa(question);
  if (!hits.length) {
    return {
      answer: "I could not find an approved CPT208 knowledge-base entry for this question.",
      sources: [],
    };
  }

  const context = hits
    .map((hit, index) => `[${index + 1}] ${hit.question}\n${hit.answer}\nSource: ${hit.source_document}`)
    .join("\n\n");

  const response = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content:
          "You answer CPT208 student questions in English. Use only the retrieved QA context. Preserve the original meaning. If the context is insufficient, say so. Cite source ids.",
      },
      {
        role: "user",
        content: `Question: ${question}\n\nRetrieved QA context:\n${context}`,
      },
    ],
  });

  return {
    answer: response.output_text,
    sources: hits,
  };
}
