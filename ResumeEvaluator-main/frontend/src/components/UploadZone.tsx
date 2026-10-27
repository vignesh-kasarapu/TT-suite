import { useDropzone } from 'react-dropzone'
import { EyeMascot } from './shared/EyeTracker'

interface UploadZoneProps {
  onFiles: (files: File[]) => void
  onFolderClick?: () => void
}

const MAX_RESUME_SIZE_BYTES = 20 * 1024 * 1024 // 20 MB per PDF/DOCX
const MAX_ZIP_SIZE_BYTES = 100 * 1024 * 1024 // 100 MB per .zip archive
const ACCEPTED_TYPES = {
  'application/pdf': ['.pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/msword': ['.doc'],
  'application/zip': ['.zip'],
  'application/x-zip-compressed': ['.zip'],
}

export default function UploadZone({ onFiles, onFolderClick }: UploadZoneProps) {
  const { getRootProps, getInputProps, isDragActive, fileRejections } = useDropzone({
    onDrop: (accepted) => {
      if (accepted.length > 0) onFiles(accepted)
    },
    accept: ACCEPTED_TYPES,
    validator: (file) => {
      const isZip = file.name.toLowerCase().endsWith('.zip')
      const limit = isZip ? MAX_ZIP_SIZE_BYTES : MAX_RESUME_SIZE_BYTES
      if (file.size > limit) {
        return {
          code: 'file-too-large',
          message: `File exceeds ${Math.round(limit / (1024 * 1024))} MB limit`,
        }
      }
      return null
    },
    multiple: true,
  })

  return (
    <div className="space-y-2">
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer transition-colors
          ${
            isDragActive
              ? 'border-accent bg-accent-100 dark:bg-accent-900'
              : 'border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 hover:border-accent hover:bg-accent-100/30 dark:hover:bg-accent-900/30'
          }`}
      >
        <input {...getInputProps()} />

        {/* Interactive Dropzone Mascot */}
        <div className="mb-3">
          <EyeMascot
            size={28}
            label={isDragActive ? 'Ready to parse!' : 'AI Resume Scanner'}
            isLookingDown={isDragActive}
            className="!py-0.5 !px-3 shadow-xs"
          />
        </div>

        {/* Upload Icon */}
        <div
          className={`w-12 h-12 rounded-full flex items-center justify-center mb-3 ${
            isDragActive ? 'bg-accent' : 'bg-accent-100 dark:bg-accent-900'
          }`}
        >
          <svg
            className={`w-6 h-6 ${isDragActive ? 'text-white' : 'text-accent'}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
        </div>

        <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
          {isDragActive ? 'Drop files here' : 'Drop PDFs, DOCX, or a .zip here'}
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          or click to browse &mdash; PDF / DOCX (max 20 MB each), or a .zip of up to 100 resumes (max 100 MB)
        </p>

        {onFolderClick && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onFolderClick() }}
            className="mt-3 flex items-center gap-1.5 text-xs text-accent dark:text-accent-300 hover:underline font-medium"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h4l2 2h6a2 2 0 012 2v1M3 7v11a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2H5a2 2 0 00-2 2v9z" />
            </svg>
            Import Folder
          </button>
        )}
      </div>

      {fileRejections.length > 0 && (
        <ul className="text-xs text-danger-800 space-y-0.5">
          {fileRejections.map(({ file, errors }) => (
            <li key={file.name}>
              {file.name}: {errors.map((e) => e.message).join(', ')}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
