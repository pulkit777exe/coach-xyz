import { notFound } from 'next/navigation'
import Link from 'next/link'

const posts: Record<string,{title:string; date:string; body:string[]}> = {
  'ai-coaching-2025': { title:'The AI-ready coaching stack for 2025', date:'Sep 10, 2025', body:['Academies are moving from scattered tools to one coaching OS.','We break down the pieces: roster, attendance, schedule, video analysis and player hub — and how we wired them with one auth, one DB, and one design system.','Takeaway: fewer integrations, faster feedback loops.'] },
  'pose-to-progress': { title:'From pose to progress: how we score form', date:'Aug 22, 2025', body:['MediaPipe extracts pose, Gemini scores mechanics against sport-specific rubrics.','Each event gets a 0-10 score and a one-line correction.','The result is an annotated video you can share before the next drill.'] },
  'attendance-that-sticks': { title:'Attendance that sticks (without spreadsheets)', date:'Aug 05, 2025', body:['The grid is the interface. Click to cycle present → late → absent → excused.','Bulk mark, add notes per student per day, export CSV.','Coaches actually use it because it feels like a roster, not a form.'] },
  'scaling-to-6-sports': { title:'Scaling to 6 sports without 6 pipelines', date:'Jul 18, 2025', body:['One pipeline, sport-aware prompts. Basketball reads jump shots, cricket reads drives.','Same upload, same UX, different rubric.','Less to maintain, more to learn.'] },
}

export function generateStaticParams(){ return Object.keys(posts).map(slug=>({slug})) }

export default async function Post({ params }: { params: Promise<{slug:string}> }){
  const { slug } = await params
  const p = posts[slug]
  if(!p) notFound()
  return (
    <main className="bg-[var(--marketing-light)] text-[var(--marketing-brown)]">
      <div className="bg-[var(--marketing-dark)] px-6 py-10 text-center">
        <Link href="/blog" className="text-sm text-[var(--marketing-beige)]/60 hover:text-[var(--marketing-beige)]">← Back to blog</Link>
        <h1 className="mx-auto mt-2 max-w-[720px] text-[26px] font-bold leading-tight text-[var(--marketing-beige)]">{p.title}</h1>
        <p className="mt-2 text-sm text-[var(--marketing-beige)]/60">{p.date}</p>
      </div>
      <article className="mx-auto max-w-[720px] px-6 py-8 lg:px-8">
        <div className="space-y-4 text-[15px] leading-7 text-[var(--marketing-brown)]/80">
          {p.body.map((para,i)=><p key={i}>{para}</p>)}
        </div>
      </article>
    </main>
  )
}
