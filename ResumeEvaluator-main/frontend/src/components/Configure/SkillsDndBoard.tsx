import React, { useState, useRef } from 'react'

// ─── Drag-and-Drop Skills Board ───────────────────────────────────────────────

interface SkillsDndBoardProps {
  filteredSkills: any[]
  requiredSkillIds: number[]
  requiredSkillNames: string[]
  niceToHaveSkillIds: number[]
  niceToHaveSkillNames: string[]
  toggleSkill: (skill: any) => void
  removeRequiredSkill: (idx: number) => void
  removeNiceToHaveSkill: (idx: number) => void
  setRequiredSkillIds: React.Dispatch<React.SetStateAction<number[]>>
  setRequiredSkillNames: React.Dispatch<React.SetStateAction<string[]>>
  setNiceToHaveSkillIds: React.Dispatch<React.SetStateAction<number[]>>
  setNiceToHaveSkillNames: React.Dispatch<React.SetStateAction<string[]>>
  deleteSkillMut: any
}

type DndCol = 'available' | 'required' | 'nicetohave'

export default function SkillsDndBoard({
  filteredSkills,
  requiredSkillIds,
  requiredSkillNames,
  niceToHaveSkillIds,
  niceToHaveSkillNames,
  toggleSkill,
  removeRequiredSkill,
  removeNiceToHaveSkill,
  setRequiredSkillIds,
  setRequiredSkillNames,
  setNiceToHaveSkillIds,
  setNiceToHaveSkillNames,
  deleteSkillMut,
}: SkillsDndBoardProps) {
  const [dragOver, setDragOver] = useState<DndCol | null>(null)
  const dragRef = useRef<{ skillId: number; skillName: string; src: DndCol } | null>(null)

  const availableSkills = filteredSkills.filter(
    (s) => !requiredSkillIds.includes(s.id) && !niceToHaveSkillIds.includes(s.id)
  )

  function handleDragStart(e: React.DragEvent, skillId: number, skillName: string, src: DndCol) {
    dragRef.current = { skillId, skillName, src }
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(skillId))
  }

  function handleDrop(e: React.DragEvent, target: DndCol) {
    e.preventDefault()
    setDragOver(null)
    const ref = dragRef.current
    if (!ref || ref.src === target) return

    const { skillId, skillName, src } = ref

    // Remove from source
    if (src === 'required') {
      const idx = requiredSkillIds.indexOf(skillId)
      if (idx !== -1) {
        setRequiredSkillIds((prev) => prev.filter((_, i) => i !== idx))
        setRequiredSkillNames((prev) => prev.filter((_, i) => i !== idx))
      }
    } else if (src === 'nicetohave') {
      const idx = niceToHaveSkillIds.indexOf(skillId)
      if (idx !== -1) {
        setNiceToHaveSkillIds((prev) => prev.filter((_, i) => i !== idx))
        setNiceToHaveSkillNames((prev) => prev.filter((_, i) => i !== idx))
      }
    }

    // Add to target
    if (target === 'required') {
      if (!requiredSkillIds.includes(skillId)) {
        setRequiredSkillIds((prev) => [...prev, skillId])
        setRequiredSkillNames((prev) => [...prev, skillName])
      }
    } else if (target === 'nicetohave') {
      if (!niceToHaveSkillIds.includes(skillId)) {
        setNiceToHaveSkillIds((prev) => [...prev, skillId])
        setNiceToHaveSkillNames((prev) => [...prev, skillName])
      }
    }
    // target === 'available' means we just removed it (already done above)
    dragRef.current = null
  }

  const colBase = 'rounded-xl border-2 p-3 min-h-[160px] flex flex-col gap-1.5 transition-all'
  const dropTarget = (col: DndCol) =>
    dragOver === col
      ? `${colBase} border-accent bg-accent-100/30 backdrop-blur-sm`
      : `${colBase} border-dashed border-white/40 dark:border-gray-700 bg-white/30 dark:bg-gray-800/30 backdrop-blur-sm`

  return (
    <div className="grid grid-cols-3 gap-3 mb-4">
      {/* Available column */}
      <div>
        <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
          Available ({availableSkills.length})
        </p>
        <div
          className={dropTarget('available')}
          onDragOver={(e) => { e.preventDefault(); setDragOver('available') }}
          onDragLeave={() => setDragOver(null)}
          onDrop={(e) => handleDrop(e, 'available')}
        >
          {availableSkills.length === 0 ? (
            <span className="text-[11px] text-gray-400 dark:text-gray-500 text-center py-4">All skills assigned</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {availableSkills.map((skill) => (
                <div
                  key={skill.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, skill.id, skill.name, 'available')}
                  className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full border cursor-grab active:cursor-grabbing select-none bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-600 hover:border-accent transition-colors"
                >
                  <span className="text-[10px] opacity-50">⠿</span>
                  {skill.name}
                  <button
                    onClick={() => toggleSkill(skill)}
                    className="opacity-50 hover:opacity-100 text-[10px]"
                    title="Add as required"
                    onMouseDown={(e) => e.stopPropagation()}
                  >+</button>
                  <button
                    onClick={() => deleteSkillMut.mutate(skill.id)}
                    className="opacity-30 hover:opacity-100 hover:text-red-500 text-[10px]"
                    title="Delete from taxonomy"
                    onMouseDown={(e) => e.stopPropagation()}
                  >×</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Required column */}
      <div>
        <p className="text-[11px] font-semibold text-accent uppercase tracking-wide mb-1.5">
          Must-Have ({requiredSkillIds.length})
        </p>
        <div
          className={dropTarget('required')}
          style={dragOver === 'required' ? { borderColor: '#534AB7', borderStyle: 'solid' } : {}}
          onDragOver={(e) => { e.preventDefault(); setDragOver('required') }}
          onDragLeave={() => setDragOver(null)}
          onDrop={(e) => handleDrop(e, 'required')}
        >
          {requiredSkillIds.length === 0 ? (
            <span className="text-[11px] text-gray-400 dark:text-gray-500 text-center py-4">Drop skills here</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {requiredSkillNames.map((name, idx) => (
                <div
                  key={requiredSkillIds[idx]}
                  draggable
                  onDragStart={(e) => handleDragStart(e, requiredSkillIds[idx], name, 'required')}
                  className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full border cursor-grab active:cursor-grabbing select-none bg-accent text-white border-accent transition-colors"
                >
                  <span className="text-[10px] opacity-70">⠿</span>
                  {name}
                  <button
                    onClick={() => removeRequiredSkill(idx)}
                    className="opacity-70 hover:opacity-100 text-[10px]"
                    onMouseDown={(e) => e.stopPropagation()}
                  >×</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Nice-to-Have column */}
      <div>
        <p className="text-[11px] font-semibold text-amber-600 uppercase tracking-wide mb-1.5">
          Nice-to-Have ({niceToHaveSkillIds.length})
        </p>
        <div
          className={dropTarget('nicetohave')}
          style={dragOver === 'nicetohave' ? { borderColor: '#F59E0B', borderStyle: 'solid' } : {}}
          onDragOver={(e) => { e.preventDefault(); setDragOver('nicetohave') }}
          onDragLeave={() => setDragOver(null)}
          onDrop={(e) => handleDrop(e, 'nicetohave')}
        >
          {niceToHaveSkillIds.length === 0 ? (
            <span className="text-[11px] text-gray-400 dark:text-gray-500 text-center py-4">Drop skills here</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {niceToHaveSkillNames.map((name, idx) => (
                <div
                  key={niceToHaveSkillIds[idx]}
                  draggable
                  onDragStart={(e) => handleDragStart(e, niceToHaveSkillIds[idx], name, 'nicetohave')}
                  className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full border cursor-grab active:cursor-grabbing select-none bg-amber-400 text-white border-amber-400 transition-colors"
                >
                  <span className="text-[10px] opacity-70">⠿</span>
                  {name}
                  <button
                    onClick={() => removeNiceToHaveSkill(idx)}
                    className="opacity-70 hover:opacity-100 text-[10px]"
                    onMouseDown={(e) => e.stopPropagation()}
                  >×</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
