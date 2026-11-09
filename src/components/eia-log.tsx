import { queryOptions, useQuery } from "@tanstack/react-query";
import { getEiaLog } from "@/lib/app.functions";
import { percent } from "@/lib/radar-ui";

export const eiaLogQuery = queryOptions({ queryKey: ["eia-log"], queryFn: () => getEiaLog() });

const mark = (v: boolean | undefined) => (v == null ? "—" : v ? "Yes" : "No");

export function EiaLog() {
  const { data = [] } = useQuery(eiaLogQuery);
  const done = data.filter((e) => e.big && e.reportHour != null);
  const pulled = done.filter((e) => e.pulledBack).length;
  const resumed = done.filter((e) => e.resumed).length;
  return (
    <section className="mt-10">
      <h2 className="mb-1 text-lg font-semibold">EIA Wednesday setup (WTI)</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Backtest, 2 years: when WTI moved more than 0.5% from the NY open (17:00 Dubai) to 19:00,
        the 19:00–20:00 report hour went against it 58% of the time (n=52), but the morning
        direction usually resumed by the close. Live results below.
      </p>
      <div className="panel mb-4 grid grid-cols-3 divide-x divide-border text-center">
        <div className="p-3">
          <p className="text-xs text-muted-foreground">Big-move Wednesdays</p>
          <p className="num mt-1 text-xl font-semibold">{done.length}</p>
        </div>
        <div className="p-3">
          <p className="text-xs text-muted-foreground">Report-hour pullback</p>
          <p className="num mt-1 text-xl font-semibold">
            {done.length ? `${Math.round((pulled / done.length) * 100)}%` : "—"}
          </p>
        </div>
        <div className="p-3">
          <p className="text-xs text-muted-foreground">Morning move resumed</p>
          <p className="num mt-1 text-xl font-semibold">
            {done.length ? `${Math.round((resumed / done.length) * 100)}%` : "—"}
          </p>
        </div>
      </div>
      {!data.length ? (
        <p className="text-sm text-muted-foreground">
          No Wednesdays logged yet. The first entry appears after this Wednesday's report.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-2 font-normal">Date</th>
                <th className="py-2 font-normal">Morning</th>
                <th className="py-2 font-normal">Report hour</th>
                <th className="py-2 font-normal">To close</th>
                <th className="py-2 font-normal">Pullback</th>
                <th className="py-2 font-normal">Resumed</th>
              </tr>
            </thead>
            <tbody>
              {data.map((e) => (
                <tr
                  key={e.date}
                  className={`border-t border-border ${e.big ? "" : "text-muted-foreground"}`}
                >
                  <td className="num py-2">{e.date.slice(5)}</td>
                  <td className="num py-2">{percent(e.morning)}</td>
                  <td className="num py-2">{percent(e.reportHour)}</td>
                  <td className="num py-2">{percent(e.toClose)}</td>
                  <td className="py-2">{e.big ? mark(e.pulledBack) : "small"}</td>
                  <td className="py-2">{e.big ? mark(e.resumed) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
