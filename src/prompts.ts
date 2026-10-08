export function notesPrompt(slice: string, index: number, total: number, language: string): { system: string; user: string } {
  return {
    system: [
      "You extract notes from one slice of a video transcript.",
      `Write in ${language}.`,
      "Keep names, numbers, claims, examples, and the order of ideas.",
      "Do not write an article, a speech, or headings that sound like a published page.",
      "Do not add facts that are not in the slice.",
    ].join(" "),
    user: `Slice ${index + 1} of ${total}:\n\n${slice}`,
  };
}

export function summaryPrompt(notes: string, language: string, videoTitle: string): { system: string; user: string } {
  return {
    system: [
      "You turn notes into a summary document for a reader who did not watch the video.",
      `Write every natural-language field in ${language}.`,
      "Return only JSON with this shape:",
      '{"title":"","language":"","dek":"","rights":"","sections":[{"heading":"","paragraphs":[""]}]}',
      "The dek is one or two sentences. Sections cover the whole set of notes.",
      "rights is one sentence telling the publisher to publish the episode only if they have the rights to the source video.",
      "Do not write a speech. Do not address a listener.",
    ].join(" "),
    user: `Video title: ${videoTitle}\n\nNotes:\n${notes}`,
  };
}

export function scriptPrompt(notes: string, language: string, videoTitle: string, forbidden: string[]): { system: string; user: string } {
  const ban =
    forbidden.length === 0
      ? "Do not copy sentences from the notes."
      : `Do not use any of these sentences, and do not use close paraphrases that keep their wording:\n${forbidden.map((sentence) => `- ${sentence}`).join("\n")}`;
  return {
    system: [
      "You write a single-host podcast monologue from notes.",
      `Speak in ${language}.`,
      "You are retelling the video to one listener. You are not reading an article aloud.",
      "No headings inside spoken lines. No 'in this section', 'as mentioned above', or 'the summary says'.",
      "Use spoken sentences. Cover the material fully. Do not cut it down to a fixed runtime.",
      "The first spoken sentence names the video title and says this is a retelling of that video.",
      "Before each new topic, put a marker line on its own: --- chapter: short title ---",
      "The marker is not spoken. Spoken lines are plain sentences.",
      ban,
    ].join(" "),
    user: `Video title: ${videoTitle}\n\nNotes:\n${notes}`,
  };
}

export function languagePrompt(sample: string): { system: string; user: string } {
  return {
    system: "Reply with only the ISO 639-1 language code of the text. No punctuation.",
    user: sample.slice(0, 2000),
  };
}
