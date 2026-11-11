"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div role="alert" className="mx-auto max-w-6xl p-12">
      <h1 className="text-2xl font-bold">数据加载失败</h1>
      <p className="my-4">请稍后重试。</p>
      <button className="bg-red-900 px-5 py-2 text-white" onClick={reset}>
        重新加载
      </button>
    </div>
  );
}
