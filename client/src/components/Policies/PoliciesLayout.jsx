import React from 'react'

const PoliciesLayout = ({ title, children }) => {
  return (
    <div className="max-w-3xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
      <div className="bg-white dark:bg-slate-800 shadow rounded-lg p-6">
        <h1 className="text-2xl font-bold mb-4">{title}</h1>
        <div className="prose prose-slate dark:prose-invert max-w-none">{children}</div>
      </div>
    </div>
  )
}

export default PoliciesLayout
