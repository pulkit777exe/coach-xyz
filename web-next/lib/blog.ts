export type BlogPost = {
  slug: string
  title: string
  excerpt: string
  date: string
  tag: string
  body: string[]
}

export const posts: BlogPost[] = [
  {
    slug: 'ai-coaching-2025',
    title: 'The AI-ready coaching stack for 2025',
    excerpt: 'How academies stitch roster, video and reports into one flow.',
    date: 'Sep 10, 2025',
    tag: 'Engineering',
    body: [
      'Academies are moving from scattered tools to one coaching OS.',
      'We break down the pieces: roster, attendance, schedule, video analysis and player hub — and how we wired them with one auth, one DB, and one design system.',
      'Takeaway: fewer integrations, faster feedback loops.',
    ],
  },
  {
    slug: 'pose-to-progress',
    title: 'From pose to progress: how we score form',
    excerpt: 'Inside our Gemini + MediaPipe pipeline and what 60s really means.',
    date: 'Aug 22, 2025',
    tag: 'Product',
    body: [
      'MediaPipe extracts pose, Gemini scores mechanics against sport-specific rubrics.',
      'Each event gets a 0-10 score and a one-line correction.',
      'The result is an annotated video you can share before the next drill.',
    ],
  },
  {
    slug: 'attendance-that-sticks',
    title: 'Attendance that sticks (without spreadsheets)',
    excerpt: 'A simple grid that coaches actually use.',
    date: 'Aug 05, 2025',
    tag: 'Design',
    body: [
      'The grid is the interface. Click to cycle present → late → absent → excused.',
      'Bulk mark, add notes per student per day, export CSV.',
      'Coaches actually use it because it feels like a roster, not a form.',
    ],
  },
  {
    slug: 'scaling-to-6-sports',
    title: 'Scaling to 6 sports without 6 pipelines',
    excerpt: 'One model, sport-aware prompts, consistent UX.',
    date: 'Jul 18, 2025',
    tag: 'Research',
    body: [
      'One pipeline, sport-aware prompts. Basketball reads jump shots, cricket reads drives.',
      'Same upload, same UX, different rubric.',
      'Less to maintain, more to learn.',
    ],
  },
]

export const postsBySlug: Record<string, BlogPost> = Object.fromEntries(
  posts.map((p) => [p.slug, p]),
)
