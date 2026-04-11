import assert from "node:assert/strict";
import test from "node:test";
import { extractOpenClawReplyFiles } from "./openclaw-output-files";

test("extractOpenClawReplyFiles captures structured media URL payloads", () => {
  const files = extractOpenClawReplyFiles({
    payload: {
      result: {
        payloads: [
          {
            text: "Here is the report.",
            mediaUrl: "https://example.com/files/report.pdf",
            fileName: "report.pdf",
            mimeType: "application/pdf",
          },
        ],
      },
    },
  });

  assert.equal(files.length, 1);
  assert.deepEqual(files[0], {
    source: "url",
    value: "https://example.com/files/report.pdf",
    fileName: "report.pdf",
    mimeType: "application/pdf",
    caption: "Here is the report.",
  });
});

test("extractOpenClawReplyFiles captures markdown-linked local files from reply text", () => {
  const files = extractOpenClawReplyFiles({
    payload: {},
    replyText: "Created: [hello.txt](/Users/joshua/.openclaw/workspace/hello.txt)",
  });

  assert.equal(files.length, 1);
  assert.equal(files[0]?.source, "path");
  assert.equal(files[0]?.value, "/Users/joshua/.openclaw/workspace/hello.txt");
  assert.equal(files[0]?.fileName, "hello.txt");
});

test("extractOpenClawReplyFiles supports base64 file payloads", () => {
  const base64 = Buffer.from("hello world").toString("base64");
  const files = extractOpenClawReplyFiles({
    payload: {
      data: {
        artifacts: [
          {
            base64,
            fileName: "notes.txt",
            contentType: "text/plain",
          },
        ],
      },
    },
  });

  assert.equal(files.length, 1);
  assert.equal(files[0]?.source, "base64");
  assert.equal(files[0]?.value, base64);
  assert.equal(files[0]?.fileName, "notes.txt");
  assert.equal(files[0]?.mimeType, "text/plain");
});

test("extractOpenClawReplyFiles deduplicates repeated references", () => {
  const files = extractOpenClawReplyFiles({
    payload: {
      payloads: [
        {
          text: "Saved [hello.txt](/tmp/hello.txt)",
          path: "/tmp/hello.txt",
          fileName: "hello.txt",
        },
      ],
    },
    replyText: "Saved [hello.txt](/tmp/hello.txt)",
  });

  assert.equal(files.length, 1);
  assert.equal(files[0]?.source, "path");
  assert.equal(files[0]?.value, "/tmp/hello.txt");
});

test("extractOpenClawReplyFiles captures markdown-linked local files from message fields", () => {
  const files = extractOpenClawReplyFiles({
    payload: {
      result: {
        message:
          "Here you go: [Joshua-Anop-public-profile.md](/Users/joshua/.openclaw/workspace/Joshua-Anop-public-profile.md)",
      },
    },
  });

  assert.equal(files.length, 1);
  assert.equal(files[0]?.source, "path");
  assert.equal(files[0]?.value, "/Users/joshua/.openclaw/workspace/Joshua-Anop-public-profile.md");
  assert.equal(files[0]?.fileName, "Joshua-Anop-public-profile.md");
});

test("extractOpenClawReplyFiles captures markdown-linked local files from reply fields", () => {
  const files = extractOpenClawReplyFiles({
    payload: {
      reply: "Saved: [profile.md](/Users/joshua/.openclaw/workspace/profile.md)",
    },
  });

  assert.equal(files.length, 1);
  assert.equal(files[0]?.source, "path");
  assert.equal(files[0]?.value, "/Users/joshua/.openclaw/workspace/profile.md");
  assert.equal(files[0]?.fileName, "profile.md");
});

test("extractOpenClawReplyFiles captures backticked local file paths", () => {
  const files = extractOpenClawReplyFiles({
    payload: {
      message: "Saved at `/Users/joshua/.openclaw/workspace/Joshua-Anop-public-profile.md`",
    },
  });

  assert.equal(files.length, 1);
  assert.equal(files[0]?.source, "path");
  assert.equal(files[0]?.value, "/Users/joshua/.openclaw/workspace/Joshua-Anop-public-profile.md");
  assert.equal(files[0]?.fileName, "Joshua-Anop-public-profile.md");
});

test("extractOpenClawReplyFiles captures bare local file paths from text", () => {
  const files = extractOpenClawReplyFiles({
    payload: {},
    replyText: "File is /Users/joshua/.openclaw/workspace/Joshua-Anop-internet-outline.md please download.",
  });

  assert.equal(files.length, 1);
  assert.equal(files[0]?.source, "path");
  assert.equal(files[0]?.value, "/Users/joshua/.openclaw/workspace/Joshua-Anop-internet-outline.md");
  assert.equal(files[0]?.fileName, "Joshua-Anop-internet-outline.md");
});
