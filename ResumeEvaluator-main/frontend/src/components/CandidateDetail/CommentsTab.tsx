import { useMemo, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { getComments, createComment, updateComment, deleteComment, getEmployeeEmails } from '../../api/client'
import type { CandidateComment, EmployeeEmail } from '../../api/client'

interface Props {
  candidateId: number
}

interface CommentNode extends CandidateComment {
  children: CommentNode[]
}

function buildTree(comments: CandidateComment[]): CommentNode[] {
  const byId = new Map<number, CommentNode>()
  comments.forEach((c) => byId.set(c.id, { ...c, children: [] }))
  const roots: CommentNode[] = []
  byId.forEach((node) => {
    if (node.parent_id != null && byId.has(node.parent_id)) {
      byId.get(node.parent_id)!.children.push(node)
    } else {
      roots.push(node)
    }
  })
  return roots
}

function timeLabel(comment: CandidateComment) {
  return new Date(comment.created_at).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

/** Textarea with "@" autocomplete against known staff emails. */
function MentionTextarea({
  value, onChange, placeholder, rows, employees, autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows: number
  employees: EmployeeEmail[]
  autoFocus?: boolean
}) {
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [query, setQuery] = useState('')

  const matches = useMemo(() => {
    if (!query) return []
    const q = query.toLowerCase()
    return employees
      .filter((e) => e.type === 'user')
      .filter((e) => e.email.toLowerCase().includes(q) || (e.name ?? '').toLowerCase().includes(q))
      .slice(0, 6)
  }, [query, employees])

  function handleChange(text: string, caret: number) {
    onChange(text)
    const upToCaret = text.slice(0, caret)
    const atIdx = upToCaret.lastIndexOf('@')
    if (atIdx === -1) { setShowSuggestions(false); return }
    const token = upToCaret.slice(atIdx + 1)
    if (/\s/.test(token)) { setShowSuggestions(false); return }
    setQuery(token)
    setShowSuggestions(true)
  }

  function pick(email: string) {
    const caret = value.lastIndexOf('@')
    if (caret === -1) return
    const before = value.slice(0, caret)
    const after = value.slice(caret + 1 + query.length)
    onChange(`${before}@${email} ${after}`)
    setShowSuggestions(false)
  }

  return (
    <div className="relative">
      <textarea
        rows={rows}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => handleChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
        className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-accent/40 resize-none"
      />
      {showSuggestions && matches.length > 0 && (
        <div className="absolute left-0 top-full mt-1 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg z-10 py-1">
          {matches.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => pick(e.email)}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200"
            >
              <span className="font-medium">{e.name ?? e.email}</span>
              {e.name && <span className="text-gray-400 ml-1">{e.email}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function CommentsTab({ candidateId }: Props) {
  const [commentText, setCommentText] = useState('')
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null)
  const [editingCommentText, setEditingCommentText] = useState('')
  const [replyingToId, setReplyingToId] = useState<number | null>(null)
  const [replyText, setReplyText] = useState('')

  const { data: commentsList = [], refetch: refetchComments } = useQuery<CandidateComment[]>({
    queryKey: ['comments', candidateId],
    queryFn: () => getComments(candidateId),
    enabled: !!candidateId,
  })

  const { data: employees = [] } = useQuery<EmployeeEmail[]>({
    queryKey: ['employee-emails'],
    queryFn: getEmployeeEmails,
  })

  const tree = useMemo(() => buildTree(commentsList), [commentsList])

  const addCommentMut = useMutation({
    mutationFn: () => createComment(candidateId, commentText),
    onSuccess: () => { setCommentText(''); refetchComments() },
  })

  const addReplyMut = useMutation({
    mutationFn: (parentId: number) => createComment(candidateId, replyText, parentId),
    onSuccess: () => { setReplyingToId(null); setReplyText(''); refetchComments() },
  })

  const editCommentMut = useMutation({
    mutationFn: (commentId: number) => updateComment(candidateId, commentId, editingCommentText),
    onSuccess: () => { setEditingCommentId(null); setEditingCommentText(''); refetchComments() },
  })

  const deleteCommentMut = useMutation({
    mutationFn: (commentId: number) => deleteComment(candidateId, commentId),
    onSuccess: () => refetchComments(),
  })

  function renderNode(node: CommentNode, depth: number) {
    return (
      <div key={node.id} className={depth > 0 ? 'ml-6 mt-3 border-l-2 border-gray-100 dark:border-gray-700 pl-4' : ''}>
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-accent/20 flex items-center justify-center text-accent text-xs font-bold">
                {(node.author_email ?? '?')[0].toUpperCase()}
              </div>
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{node.author_email ?? 'Unknown'}</span>
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {timeLabel(node)}
                {node.updated_at && <span className="ml-1 italic">(edited)</span>}
              </span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setReplyingToId(node.id); setReplyText('') }}
                className="text-xs text-gray-300 dark:text-gray-600 hover:text-accent dark:hover:text-accent-300 transition-colors"
              >Reply</button>
              <button
                onClick={() => { setEditingCommentId(node.id); setEditingCommentText(node.body) }}
                className="text-xs text-gray-300 dark:text-gray-600 hover:text-accent dark:hover:text-accent-300 transition-colors"
              >Edit</button>
              <button
                onClick={() => deleteCommentMut.mutate(node.id)}
                className="text-xs text-gray-300 dark:text-gray-600 hover:text-danger transition-colors"
              >Delete</button>
            </div>
          </div>
          {editingCommentId === node.id ? (
            <div className="space-y-2">
              <MentionTextarea rows={3} value={editingCommentText} onChange={setEditingCommentText} employees={employees} autoFocus />
              <div className="flex gap-2">
                <button
                  onClick={() => editCommentMut.mutate(node.id)}
                  disabled={editCommentMut.isPending || !editingCommentText.trim()}
                  className="text-xs bg-accent hover:bg-accent-700 disabled:opacity-50 text-white rounded-lg px-3 py-1.5 transition-colors"
                >
                  {editCommentMut.isPending ? 'Saving…' : 'Save'}
                </button>
                <button
                  onClick={() => { setEditingCommentId(null); setEditingCommentText('') }}
                  className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-3 py-1.5 transition-colors"
                >Cancel</button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{node.body}</p>
          )}

          {replyingToId === node.id && (
            <div className="mt-3 space-y-2">
              <MentionTextarea rows={2} value={replyText} onChange={setReplyText} placeholder="Write a reply… use @ to mention someone" employees={employees} autoFocus />
              <div className="flex gap-2">
                <button
                  onClick={() => addReplyMut.mutate(node.id)}
                  disabled={addReplyMut.isPending || !replyText.trim()}
                  className="text-xs bg-accent hover:bg-accent-700 disabled:opacity-50 text-white rounded-lg px-3 py-1.5 transition-colors"
                >
                  {addReplyMut.isPending ? 'Posting…' : 'Post Reply'}
                </button>
                <button
                  onClick={() => { setReplyingToId(null); setReplyText('') }}
                  className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-3 py-1.5 transition-colors"
                >Cancel</button>
              </div>
            </div>
          )}
        </div>
        {node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    )
  }

  return (
    <div className="p-6 max-w-2xl space-y-4">
      {tree.length === 0 && (
        <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">No comments yet. Be the first to add one.</p>
      )}
      <div className="space-y-3">
        {tree.map((node) => renderNode(node, 0))}
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
        <MentionTextarea
          rows={3}
          value={commentText}
          onChange={setCommentText}
          placeholder="Add a comment visible to all team members… use @ to mention someone"
          employees={employees}
        />
        <div className="flex items-center gap-3">
          <button
            onClick={() => addCommentMut.mutate()}
            disabled={addCommentMut.isPending || !commentText.trim()}
            className="bg-accent hover:bg-accent-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
          >
            {addCommentMut.isPending ? 'Posting…' : 'Post Comment'}
          </button>
          {addCommentMut.isError && <span className="text-xs text-red-500">Failed to post comment</span>}
        </div>
      </div>
    </div>
  )
}
