import React from 'react'

export default function UploadZone({ onFiles, inputRef }) {
  const openPicker = () => {
    inputRef.current?.click()
  }

  const handleDrop = (e) => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files || [])
    onFiles(files)
  }

  const handleChange = (e) => {
    const files = Array.from(e.target.files || [])
    onFiles(files)
  }

  return (
    <div
      className="dropzone"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      onClick={openPicker}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.pdf"
        multiple
        onChange={handleChange}
        className="hidden"
      />
      <div className="flex flex-col items-center gap-2">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
          <path d="M12 16V4m0 0l-4 4m4-4l4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <div className="font-semibold">Drag and drop files here or click to select</div>
        <div className="text-sm opacity-70">Images and PDF are supported. Several at once.</div>
      </div>
    </div>
  )
}