/**
 * PLACEHOLDER COPY for the founder to replace. These are general dental care tips in plain English,
 * written to be medically conservative: no doses, no diagnosis, always "follow your dentist's
 * advice". Replace the text (and later translate it) before relying on it; the page code does not
 * need to change.
 */
export interface LearnTopic {
  slug: string;
  title: string;
  summary: string;
  /** Short paragraphs, then a short list of tips. */
  intro: string;
  tips: string[];
}

const ADVICE = "If your dentist gave you different advice, follow your dentist's advice.";

export const LEARN_TOPICS: readonly LearnTopic[] = [
  {
    slug: "brushing-and-flossing",
    title: "Brushing and flossing",
    summary: "Simple daily habits that keep teeth and gums healthy.",
    intro: `Gentle, regular cleaning does more than occasional hard scrubbing. ${ADVICE}`,
    tips: [
      "Brush twice a day with a soft brush and fluoride toothpaste.",
      "Brush for about two minutes, using small gentle circles.",
      "Clean between your teeth once a day with floss or small interdental brushes.",
      "Replace your toothbrush every few months, or sooner if the bristles spread.",
    ],
  },
  {
    slug: "after-a-tooth-extraction",
    title: "After a tooth extraction",
    summary: "General care in the first days after a tooth is taken out.",
    intro: `Healing is usually smooth if the area is left alone to settle. ${ADVICE}`,
    tips: [
      "Avoid touching the area with your tongue or fingers.",
      "Avoid spitting hard, using a straw or rinsing forcefully on the first day.",
      "Choose soft, lukewarm food and chew on the other side.",
      "Keep brushing the rest of your mouth, gently around the area.",
      "Call the clinic if bleeding does not settle, or pain or swelling gets worse.",
    ],
  },
  {
    slug: "after-a-root-canal",
    title: "After a root canal",
    summary: "What to expect once a root canal treatment visit is done.",
    intro: `Some tenderness for a few days can be normal. ${ADVICE}`,
    tips: [
      "Avoid chewing hard food on the treated tooth until it is fully restored.",
      "Keep brushing and cleaning between your teeth as usual.",
      "Come back for the final filling or crown when your dentist advises.",
      "Call the clinic if a temporary filling comes out, or pain or swelling increases.",
    ],
  },
  {
    slug: "tooth-sensitivity",
    title: "Sensitive teeth",
    summary: "Why teeth can feel sensitive and gentle ways to look after them.",
    intro: `Sensitivity to hot, cold or sweet things has several possible causes, so it is worth having it checked. ${ADVICE}`,
    tips: [
      "Use a soft brush and avoid brushing too hard.",
      "Ask your dentist about toothpaste made for sensitive teeth.",
      "Limit very acidic or very sugary drinks.",
      "Book a visit if the sensitivity is strong, lasts, or is in one tooth only.",
    ],
  },
  {
    slug: "childrens-first-visit",
    title: "A child's first dental visit",
    summary: "Making the first visit calm and easy for your child.",
    intro: `A short, friendly first visit helps children feel at ease. ${ADVICE}`,
    tips: [
      "Talk about the visit in a positive, simple way.",
      "Choose a time when your child is rested and fed.",
      "Bring a list of any questions, and tell the dentist about any health concerns.",
      "Help young children brush until they can do it well themselves.",
    ],
  },
  {
    slug: "when-to-call-the-clinic",
    title: "When to call the clinic",
    summary: "Signs that mean you should get in touch with us.",
    intro: "This is a general guide only and cannot replace advice from your dentist.",
    tips: [
      "Pain that is getting worse or is not helped by your usual care.",
      "Swelling of the face or gums, or a bad taste or discharge from a tooth.",
      "Bleeding that does not stop.",
      "A broken tooth, a lost filling or crown, or an injury to the mouth.",
      "Trouble swallowing or breathing, or a fever with swelling: seek urgent medical help.",
    ],
  },
];

export function findLearnTopic(slug: string | undefined): LearnTopic | undefined {
  return LEARN_TOPICS.find((topic) => topic.slug === slug);
}
