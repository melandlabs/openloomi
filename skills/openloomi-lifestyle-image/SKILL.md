---
name: openloomi-lifestyle-image
description: Identify whether a user is asking OpenLoomi to generate a lifestyle image, portrait, personal visual, or lifestyle scene. Use this skill for chat messages that may request image generation for a user's lifestyle, identity, persona, personal brand, social profile, memories, interests, or real-life scene; distinguish true generation intent from ordinary image understanding, prompt-writing, editing, or negated requests.
---

# OpenLoomi Lifestyle Image

## Purpose

Decide whether the user is asking to generate a lifestyle image through OpenLoomi's existing lifestyle image flow. This skill only judges intent and prepares a decision signal for the host app. Do not call image generation providers from this skill.

## Decision

Return a lifestyle image generation decision only when the user clearly wants OpenLoomi to create or generate a lifestyle-oriented image.

Use `matched: true` when the request asks to generate, create, make, draw, design, render, or produce a lifestyle image, personal visual, avatar-like lifestyle scene, personal brand image, social profile visual, or life-scene image based on the user's profile, memory, interests, chat context, or uploaded reference image.

Use `matched: false` when the user is only asking to:

- Analyze, identify, describe, OCR, classify, or understand an uploaded image.
- Write or improve a prompt without asking to generate the image now.
- Edit an existing image without asking for lifestyle generation.
- Discuss image generation conceptually.
- Say not to generate an image, or says image generation is unnecessary.
- Ask an unrelated design, document, code, or chat question.

## Reference Images

Set `hasReferenceImage: true` when the current user message includes an uploaded image that appears intended as style, subject, persona, or visual reference for generation.

Do not set `matched: true` only because an image was uploaded. If the user asks what the image shows, who the character is, or asks for image understanding, return `matched: false`.

If the user uploads a reference image and also asks to generate a lifestyle image from or inspired by it, return `matched: true` and `hasReferenceImage: true`.

## Output Contract

When the host requests a structured decision, return only JSON with this shape:

```json
{
  "matched": true,
  "confidence": "high",
  "reason": "explicit_lifestyle_image_generation_request",
  "hasReferenceImage": false,
  "refinedPrompt": "optional concise generation intent"
}
```

Rules:

- `matched` must be boolean.
- `confidence` must be `high`, `medium`, or `low`.
- Use `confidence: "high"` only when the user clearly wants generation now.
- Use `confidence: "medium"` when lifestyle generation is plausible but underspecified.
- Use `confidence: "low"` with `matched: false` for ordinary chat or image understanding.
- `reason` should be a short snake_case string.
- `hasReferenceImage` must be boolean.
- `refinedPrompt` is optional and should preserve the user's intent without inventing new identity details.

## Examples

User: "Generate a lifestyle image for my LinkedIn profile based on my interests."

Decision: `matched: true`, `confidence: "high"`, `hasReferenceImage: false`.

User: "Use this photo as a style reference and create a lifestyle portrait."

Decision: `matched: true`, `confidence: "high"`, `hasReferenceImage: true`.

User: "What character is in this image?"

Decision: `matched: false`, `confidence: "low"`, `hasReferenceImage: false`.

User: "Help me write a prompt for a lifestyle image."

Decision: `matched: false`, `confidence: "low"`, `hasReferenceImage: false`.

User: "Do not generate an image, just describe the idea."

Decision: `matched: false`, `confidence: "low"`, `hasReferenceImage: false`.
