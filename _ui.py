from pathlib import Path
p = Path("components/athlete-profile.tsx")
t = p.read_text(encoding="utf-8")
old = '''          {pbEvents.map((event) => {
            const pb = profile.supplement?.personalBests.find((item) => item.event === event.id);
            const source = pb && profile.sources.find((item) => item.id === pb.sourceId);
            return (
              <div key={event.id} className="min-w-0 px-3 py-5 first:pl-0 sm:px-5">
                <h3 className="text-sm font-semibold">{event.label}</h3>
                <p
                  className="mt-2 font-mono text-2xl tabular-nums sm:text-3xl"
                  aria-label={pb ? `${event.label} 个人最佳 ${formatPersonalBest(pb)}` : `${event.label} 成绩尚未收录`}
                >
                  {pb ? formatPersonalBest(pb) : "—"}
                </p>
                {pb ? (
                  <>
                    <p className="mt-2 text-xs text-[var(--muted)]">
                      <time dateTime={pb.achievedOn}>{pb.achievedOn}</time>
                    </p>
                    <p className="mt-1 break-words text-xs text-[var(--muted)]">{pb.meet}</p>
                    {source && (
                      <a className="archive-link mt-2 inline-block text-xs" href={source.url}>
                        成绩来源 ↗
                      </a>
                    )}
                  </>
                ) : (
                  <p className="mt-2 text-xs text-[var(--muted)]">尚未收录</p>
                )}
              </div>
            );
          })}'''
new = '''          {pbEvents.map((event) => {
            const pb = profile.supplement?.personalBests.find((item) => item.event === event.id);
            const source = pb && profile.sources.find((item) => item.id === pb.sourceId);
            const status = personalBestStatus(profile.supplement, event.id);
            return (
              <div key={event.id} className="min-w-0 px-3 py-5 first:pl-0 sm:px-5">
                <h3 className="text-sm font-semibold">{event.label}</h3>
                <p
                  className="mt-2 font-mono text-2xl tabular-nums sm:text-3xl"
                  aria-label={
                    pb
                      ? `${event.label} 个人最佳 ${formatPersonalBest(pb)}${pb.indoor ? "（室内）" : ""}`
                      : status === "verified-absent"
                        ? `${event.label} 暂无正式成绩`
                        : `${event.label} 成绩尚未收录`
                  }
                >
                  {pb ? formatPersonalBest(pb) : "—"}
                  {pb?.indoor && (
                    <span className="ml-2 rounded-sm border border-[var(--line)] px-1 py-0.5 align-middle font-sans text-[10px] font-normal text-[var(--muted)]">
                      室内
                    </span>
                  )}
                </p>
                {pb ? (
                  <>
                    <p className="mt-2 text-xs text-[var(--muted)]">
                      <time dateTime={pb.achievedOn}>{pb.achievedOn}</time>
                    </p>
                    <p className="mt-1 break-words text-xs text-[var(--muted)]">{pb.meet}</p>
                    {source && (
                      <a className="archive-link mt-2 inline-block text-xs" href={source.url}>
                        成绩来源 ↗
                      </a>
                    )}
                  </>
                ) : status === "verified-absent" ? (
                  <p className="mt-2 text-xs text-[var(--muted)]">暂无正式成绩</p>
                ) : (
                  <p className="mt-2 text-xs text-[var(--muted)]">尚未收录</p>
                )}
              </div>
            );
          })}'''
assert old in t
t = t.replace(old, new)
t = t.replace(
  "仅展示已核实的独立项目成绩，不使用驿传区间用时推算；缺失项目不代表选手没有参赛。",
  "仅展示已核实的独立项目成绩，不使用驿传区间用时推算；「尚未收录」表示尚未找到可核实资料，「暂无正式成绩」表示已确认没有正式成绩。"
)
p.write_text(t, encoding="utf-8", newline="\n")
