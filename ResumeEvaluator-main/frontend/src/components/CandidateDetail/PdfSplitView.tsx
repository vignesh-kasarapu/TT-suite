import { useEffect, useRef, useState, useCallback } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import type { EvaluationDetail } from '../../api/client'
import { fetchResumeFileBlob } from '../../api/client'
import ScoreBar from '../ScoreBar'

import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// Point pdfjs worker at the bundled copy shipped with the package
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl


interface Props {
  detail: EvaluationDetail
  resumeId: number
  onClose: () => void
}

interface HighlightRect {
  x: number
  y: number
  w: number
  h: number
  label: string
  color: string
}

const HIGHLIGHT_COLORS = ['#534AB7', '#1D9E75', '#EF9F27', '#E24B4A', '#0891b2', '#7c3aed']

function normalizeExcerpt(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase()
}

interface PageData {
  canvas: HTMLCanvasElement
  highlights: HighlightRect[]
}

export default function PdfSplitView({ detail, resumeId, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [pages, setPages] = useState<PageData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hoveredSkill, setHoveredSkill] = useState<string | null>(null)
  const [scale, setScale] = useState(1.2)
  const [activeMobileTab, setActiveMobileTab] = useState<'pdf' | 'details'>('pdf')
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const prevBlobUrl = useRef<string | null>(null)

  const excerptMap = useCallback((): { text: string; label: string; color: string }[] => {
    const result: { text: string; label: string; color: string }[] = []
    detail.skills_matched?.forEach((sm, i) => {
      if (sm.excerpt) {
        result.push({
          text: normalizeExcerpt(sm.excerpt),
          label: sm.skill_name,
          color: HIGHLIGHT_COLORS[i % HIGHLIGHT_COLORS.length],
        })
      }
    })
    detail.excerpts?.forEach((ex, i) => {
      if (ex) {
        result.push({
          text: normalizeExcerpt(ex),
          label: `Evidence ${i + 1}`,
          color: HIGHLIGHT_COLORS[((detail.skills_matched?.length ?? 0) + i) % HIGHLIGHT_COLORS.length],
        })
      }
    })
    return result
  }, [detail])

  useEffect(() => {
    let cancelled = false
    if (prevBlobUrl.current) {
      URL.revokeObjectURL(prevBlobUrl.current)
      prevBlobUrl.current = null
    }
    async function render() {
      setLoading(true)
      setError(null)
      try {
        const blob = await fetchResumeFileBlob(resumeId)
        if (cancelled) return
        const objectUrl = URL.createObjectURL(blob)
        prevBlobUrl.current = objectUrl
        setBlobUrl(objectUrl)
        const arrayBuffer = await blob.arrayBuffer()
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
        const pdf = await loadingTask.promise
        if (cancelled) return

        const numPages = pdf.numPages
        const excerpts = excerptMap()
        const rendered: PageData[] = []

        for (let pageNum = 1; pageNum <= numPages; pageNum++) {
          if (cancelled) break
          const page = await pdf.getPage(pageNum)
          const viewport = page.getViewport({ scale })

          const canvas = document.createElement('canvas')
          canvas.width = viewport.width
          canvas.height = viewport.height

          const ctx = canvas.getContext('2d')!
          await page.render({ canvasContext: ctx, viewport } as any).promise
          if (cancelled) break

          // Extract text content and find excerpt positions
          const textContent = await page.getTextContent()
          const fullText = textContent.items
            .map((item: any) => item.str ?? '')
            .join(' ')
          const fullNorm = normalizeExcerpt(fullText)

          const highlights: HighlightRect[] = []

          for (const ex of excerpts) {
            if (!fullNorm.includes(ex.text.slice(0, 30))) continue

            // Search for the first text item where the excerpt starts
            // Use a tight window (15 items max) so we don't paint paragraphs
            let searchTarget = ex.text.length > 20 ? ex.text.slice(0, 20) : ex.text
            let startIdx = -1
            let endIdx = -1

            for (let i = 0; i < textContent.items.length; i++) {
              let textChunk = ''
              const windowSize = Math.min(15, textContent.items.length - i)
              for (let j = i; j < i + windowSize; j++) {
                const item: any = textContent.items[j]
                textChunk += item.str ?? ' '
                if (normalizeExcerpt(textChunk).includes(searchTarget)) {
                  startIdx = i
                  endIdx = j
                  break
                }
              }
              if (startIdx !== -1) break
            }

            if (startIdx === -1) continue

            // Group matched items by Y row so we draw ONE rect per line of text
            // (never a massive multi-item blob)
            const matchedItems = textContent.items.slice(startIdx, endIdx + 1)
            const rowMap = new Map<number, { xMin: number; xMax: number; yMin: number; yMax: number }>()
            const Y_TOLERANCE = 3 // px — items within 3px share the same line

            for (const item of matchedItems) {
              const tx: any = item
              if (!tx.transform || !tx.str?.trim()) continue
              const [a, b, c, d, e, f] = tx.transform
              const scaleX = Math.sqrt(a * a + b * b)
              const scaleY = Math.sqrt(c * c + d * d)
              const pt = viewport.convertToViewportPoint(e, f)
              const x0 = pt[0]
              const y0 = pt[1] - scaleY * scale
              const w0 = (tx.width ?? 30) * scaleX * scale
              const h0 = Math.max((tx.height ?? 10) * scaleY * scale, 10)

              // Find an existing row within tolerance
              let rowKey: number | null = null
              for (const [key] of rowMap) {
                if (Math.abs(key - y0) <= Y_TOLERANCE) { rowKey = key; break }
              }
              if (rowKey === null) {
                rowMap.set(y0, { xMin: x0, xMax: x0 + w0, yMin: y0, yMax: y0 + h0 })
              } else {
                const row = rowMap.get(rowKey)!
                row.xMin = Math.min(row.xMin, x0)
                row.xMax = Math.max(row.xMax, x0 + w0)
                row.yMin = Math.min(row.yMin, y0)
                row.yMax = Math.max(row.yMax, y0 + h0)
              }
            }

            // Emit one highlight rect per line
            for (const row of rowMap.values()) {
              highlights.push({
                x: row.xMin,
                y: row.yMin,
                w: Math.max(row.xMax - row.xMin, 4),
                h: Math.max(row.yMax - row.yMin, 10),
                label: ex.label,
                color: ex.color,
              })
            }
          }

          rendered.push({ canvas, highlights })
        }

        if (!cancelled) {
          setPages(rendered)
          setLoading(false)
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message ?? 'Failed to render PDF')
          setLoading(false)
        }
      }
    }

    render()
    return () => { cancelled = true }
  }, [resumeId, scale, excerptMap])

  const activeExcerpts = detail.skills_matched?.filter((s) => s.excerpt) ?? []

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">
            {detail.candidate_name} — Resume Viewer
          </h2>
          <span className="text-xs text-gray-400">{detail.job_role_title}</span>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-xs text-gray-500 flex items-center gap-1.5">
            Zoom
            <input
              type="range" min={0.7} max={2.5} step={0.1} value={scale}
              onChange={(e) => setScale(Number(e.target.value))}
              className="w-20 h-1.5"
            />
            <span className="tabular-nums w-8">{Math.round(scale * 100)}%</span>
          </label>
          {blobUrl && (
            <a
              href={blobUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-1"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              Open PDF
            </a>
          )}
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile Tab Switcher */}
      <div className="flex md:hidden border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shrink-0">
        <button
          onClick={() => setActiveMobileTab('pdf')}
          className={`flex-1 py-3 text-center text-xs font-bold uppercase tracking-wider border-b-2 transition-colors ${
            activeMobileTab === 'pdf'
              ? 'border-accent text-accent'
              : 'border-transparent text-gray-500 dark:text-gray-400'
          }`}
        >
          Resume PDF
        </button>
        <button
          onClick={() => setActiveMobileTab('details')}
          className={`flex-1 py-3 text-center text-xs font-bold uppercase tracking-wider border-b-2 transition-colors ${
            activeMobileTab === 'details'
              ? 'border-accent text-accent'
              : 'border-transparent text-gray-500 dark:text-gray-400'
          }`}
        >
          AI Match Details
        </button>
      </div>

      {/* Split panels */}
      <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
        {/* Left: PDF */}
        <div
          ref={containerRef}
          className={`flex-1 overflow-auto bg-gray-200 dark:bg-gray-800 p-4 space-y-4 ${
            activeMobileTab === 'pdf' ? 'block' : 'hidden md:block'
          }`}
        >
          {loading && (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3">
              <svg className="animate-spin w-8 h-8" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-sm">Rendering PDF…</span>
            </div>
          )}
          {error && (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <p className="text-sm text-red-500">{error}</p>
              {blobUrl && (
                <a href={blobUrl} target="_blank" rel="noreferrer" className="text-sm text-accent underline">
                  Open PDF in new tab
                </a>
              )}
            </div>
          )}
          {!loading && !error && pages.map((pg, idx) => (
            <div key={idx} className="relative inline-block shadow-lg mx-auto block">
              <canvas
                ref={(el) => { if (el) { el.width = pg.canvas.width; el.height = pg.canvas.height; el.getContext('2d')!.drawImage(pg.canvas, 0, 0) } }}
                style={{ display: 'block', maxWidth: '100%' }}
              />
              {/* Highlight overlays — hidden until the matching skill/evidence is hovered, so a
                  resume with many overlapping skill matches doesn't render as a solid color blur */}
              {pg.highlights.map((h, hi) => {
                const isActive = hoveredSkill === h.label
                if (!isActive) return null
                return (
                  <div
                    key={hi}
                    title={h.label}
                    style={{
                      position: 'absolute',
                      left: h.x,
                      top: h.y,
                      width: Math.max(h.w, 4),
                      height: Math.max(h.h, 8),
                      background: h.color + '55',
                      border: `1px solid ${h.color}cc`,
                      borderRadius: 2,
                      pointerEvents: 'none',
                      transition: 'background 0.15s',
                    }}
                  />
                )
              })}
            </div>
          ))}
        </div>

        {/* Right: Score card */}
        <div className={`w-full md:w-80 md:xl:w-96 shrink-0 overflow-y-auto bg-white dark:bg-gray-900 border-t md:border-t-0 md:border-l border-gray-200 dark:border-gray-700 p-4 space-y-4 ${
          activeMobileTab === 'details' ? 'block' : 'hidden md:block'
        }`}>
          {/* Score summary */}
          <div className="flex items-center gap-3 p-3 bg-accent-100/40 dark:bg-accent-900/40 rounded-xl border border-accent-300/30">
            <div className="text-center">
              <div
                className="text-2xl font-black tabular-nums"
                style={{ color: detail.total_score >= 75 ? '#1D9E75' : detail.total_score >= 50 ? '#EF9F27' : '#E24B4A' }}
              >
                {Math.round(detail.total_score)}
              </div>
              <div className="text-[10px] text-gray-400 uppercase">Score</div>
            </div>
            <div className="flex-1 space-y-1.5 min-w-0">
              <ScoreBar label="Projects" value={detail.project_score} color="#534AB7" />
              <ScoreBar label="Skills" value={detail.skill_score} color="#1D9E75" />
              <ScoreBar label="Education" value={detail.education_score} color="#EF9F27" />
            </div>
          </div>

          {/* Matched skills with hover */}
          {activeExcerpts.length > 0 && (
            <div>
              <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                Matched Skills — hover to highlight
              </p>
              <div className="flex flex-wrap gap-1.5">
                {activeExcerpts.map((sm, i) => (
                  <button
                    key={sm.skill_name}
                    onMouseEnter={() => setHoveredSkill(sm.skill_name)}
                    onMouseLeave={() => setHoveredSkill(null)}
                    className="text-xs px-2.5 py-1 rounded-full border font-medium transition-all"
                    style={{
                      borderColor: HIGHLIGHT_COLORS[i % HIGHLIGHT_COLORS.length] + '80',
                      color: HIGHLIGHT_COLORS[i % HIGHLIGHT_COLORS.length],
                      background: hoveredSkill === sm.skill_name
                        ? HIGHLIGHT_COLORS[i % HIGHLIGHT_COLORS.length] + '20'
                        : HIGHLIGHT_COLORS[i % HIGHLIGHT_COLORS.length] + '08',
                    }}
                  >
                    {sm.skill_name}
                    <span className="ml-1 opacity-60">({Math.round(sm.score)})</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Excerpts */}
          {detail.excerpts && detail.excerpts.length > 0 && (
            <div>
              <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                Key Evidence
              </p>
              <div className="space-y-2">
                {detail.excerpts.slice(0, 5).map((ex, i) => (
                  <blockquote
                    key={i}
                    onMouseEnter={() => setHoveredSkill(`Evidence ${i + 1}`)}
                    onMouseLeave={() => setHoveredSkill(null)}
                    className="text-xs text-gray-700 dark:text-gray-300 border-l-2 pl-3 py-1 leading-relaxed italic cursor-default"
                    style={{ borderColor: HIGHLIGHT_COLORS[i % HIGHLIGHT_COLORS.length] }}
                  >
                    {ex.length > 160 ? ex.slice(0, 160) + '…' : ex}
                  </blockquote>
                ))}
              </div>
            </div>
          )}

          {/* Reasoning */}
          {detail.reasoning_summary && (
            <div>
              <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">AI Summary</p>
              <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">{detail.reasoning_summary}</p>
            </div>
          )}

          {/* Skill gaps */}
          {detail.skill_gaps?.length > 0 && (
            <div>
              <p className="text-xs font-bold text-danger uppercase tracking-wider mb-2">Skill Gaps</p>
              <div className="flex flex-wrap gap-1">
                {detail.skill_gaps.map((gap) => (
                  <span key={gap} className="text-[11px] px-2 py-0.5 rounded-full bg-danger-100 text-danger-800 border border-danger/30">
                    {gap}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
