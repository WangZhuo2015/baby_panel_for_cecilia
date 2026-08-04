'use client'

interface DataVersionBadgeProps {
  organization?: string
  asOf?: string
  className?: string
}

export default function DataVersionBadge({ organization, asOf, className = '' }: DataVersionBadgeProps) {
  if (!organization && !asOf) return null

  return (
    <div className={`flex items-center gap-1.5 text-xs text-gray-500 ${className}`}>
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400"></span>
      {organization && <span>数据依据：{organization}</span>}
      {asOf && <span>· 数据核对日期：{asOf}</span>}
    </div>
  )
}
