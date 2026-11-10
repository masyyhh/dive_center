# Read performance and five-year benchmark

## Measured results — 9 November 2026

The completed synthetic dataset contains 1,826,000 bills, 9,130,000 line items,
182,600 attendance records and ten properties. Its tables and indexes occupy
approximately 4 GB. October 2026 reporting for one property includes 2,976 active
bills and 14,880 lines.

Measurements ran locally on an Apple M1 Max with ten CPU cores and 32 GB RAM,
Node 24.22.1 and PostgreSQL 18.6. PostgreSQL used 128 MB shared buffers, 4 MB
work memory and at most 40 connections. Report workers used precompiled JavaScript
and a 384 MB JS heap limit. There was no total-RSS/container memory cap. Three
samples were taken per successful case except the global dashboard, which used
two. These are small-sample local measurements, not production latency percentiles.

| Operation | Measured time | Scope |
| --- | --- | --- |
| Bill list | 1.4–7.8 ms | First 50 summaries in a month |
| Bill search | 3.1–9.8 ms | Guest substring within a month |
| Bill search across five years | 46–56 ms | One property's full history |
| Property dashboard | 668–726 ms | October 2026, including commissions and JSON |
| Daily PDF | 80–137 ms | 31 October 2026 |
| Monthly PDF | 3.18–4.03 s | October 2026 |
| Monthly Excel | 1.35–1.45 s | October 2026 |
| Four simultaneous monthly dashboards | 1.15–1.48 s | Time for all four operations to finish |
| Global monthly dashboard | 6.44–7.03 s | All ten properties |
| Full calendar-year dashboard | Failed | 2025: JavaScript heap exhausted |
| Full five-year dashboard | Failed | Prisma could not convert the oversized Rust result into a JS string |

The original monthly dashboard median was 2,076.6 ms; the optimized median is
704.4 ms, approximately 66% faster. It performs one Bill read instead of two,
and ten SQL queries instead of twelve in the serial measurements. The original
bill-list median was 1,052.9 ms, returning all 3,100 bills with lines; the new
bounded list returns 50 summaries, so its latency improvement includes both less
database work and a deliberately smaller response. The monthly search median
changed from 949.0 ms to approximately 3.2 ms.

Baseline and optimized financial headlines, category revenue and employee
commissions matched exactly. SQL aggregation independently confirmed monthly
active-bill count and net revenue. EXPLAIN ANALYZE confirmed use of the new bill
paging and bill-line indexes. The database plan times for the representative
paging and bill-line queries were 0.379 ms and 0.032 ms respectively; those plan
times exclude application work and are not API response times.

Memory remains a deployment limitation: peak process RSS over repeated monthly
dashboard calls was approximately 653 MB, monthly PDF 974 MB, and monthly Excel
870 MB. Four concurrent dashboards reached approximately 2.0 GB. These exceed
the current 512 MB backend container limit. The measured runtimes therefore must
not be promised under that existing container limit. A larger report worker is a
possible interim deployment choice, but bounded/batched report processing and
daily summaries are needed before offering broad report ranges through the API.
The five-year report failure is not a successful 43-second report; it is a failed
request after approximately 43 seconds.

Both builds pass, as do 300 backend tests and 150 frontend tests. No production
data, deployment or database configuration was changed. Raw samples, failure
messages, baseline revision, memory figures and query plans are retained in
`outputs/five-year-benchmark/`. Prisma's asynchronous query-event counts can
undercount simultaneous SQL work; do not use the concurrency case's event counts
as an exact query inventory. Its reported duration covers completion of all four
operations.

## Changes

`GET /api/bills` now returns at most 50 bill summaries by default, with a maximum
`limit` of 100. It returns `{ bills, nextCursor, hasMore, limit }`. Pass the opaque
`nextCursor` back as `cursor` with the same property, date, status, search and
discount filters. The ordering is business date, check number, then ID, all
descending. The ID breaks ties, including deleted checks whose number was reused.
Changing filters requires starting from the first page. Concurrent re-dates can
move a bill across a page boundary; this endpoint does not promise a historical
snapshot across separate requests.

When both date boundaries are omitted, the default is the current business month
through today in Indian/Maldives. Explicit one-sided date ranges remain supported.
Search is a literal, case-insensitive substring of guest name, room number,
nationality or the text representation of the check number. `%`, `_` and backslash
are escaped as literal search characters. Values are bound parameters. Search is
limited to 200 characters; `discountedOnly=true` filters in SQL before pagination.

List responses omit line items, notes and creator relationships. Fetch
`GET /api/bills/:id` when opening a bill. Both bill-list layouts use server pages.
The overview requests only six recent bills and obtains the full day's active
bill count and total from the report's daily trends, rather than summing a partial
bill page. Browser printing of the bill list includes only the loaded page;
financial reports continue to use the report endpoints.

The property dashboard fetches its period's active bills, saved line snapshots,
catalogue fallbacks and instructor/photo recipients once, then passes that dataset
to the existing commission calculation. Payroll eligibility and rounding rules
are unchanged. Other callers can still let the commission service fetch its data.
This is request-local reuse, not a cross-request cache.

The read-performance migration adds indexes for bill paging, status/date reporting,
room lookup, bill-line joins/order, catalogue usage, package usage, active property
staff, audit pagination and recent water-sports records. Existing indexes and the
partial unique live-check constraint are retained.

## Deploying indexes on a busy database

The migration is
`backend/prisma/migrations/20261109000000_read_performance/migration.sql`.
Normal index builds block writes to the affected table while building. Apply
through the usual deployment process in a maintenance window, or prebuild the
same named indexes concurrently, one statement at a time, before running
`prisma migrate deploy`. Replace `CREATE INDEX IF NOT EXISTS` with
`CREATE INDEX CONCURRENTLY IF NOT EXISTS` for that prebuild. Execute each statement
outside a transaction; sending the entire group as one SQL command can cause
PostgreSQL to reject concurrent builds. The migration then skips the existing
named indexes. Verify their definitions and `pg_index.indisvalid` before deploying.
An interrupted concurrent build can leave an invalid index that must be removed
and rebuilt; do not treat an existing name alone as proof of a usable index.

Deploy the backend and frontend together: older consumers expecting all bills or
embedded line items must adopt the new list contract. No production migration or
deployment is performed by the benchmark.

## Repeating the benchmark

Use Node 22 or 24, an isolated loopback PostgreSQL instance, and a database name
ending in `_test`. The runner rejects other hosts/database names and creates a
dedicated random schema with the normal migrations. It never reads the application
database URL to choose a target.

```sh
BENCHMARK_DATABASE_URL=postgresql://benchmark@127.0.0.1:55439/dive_performance_test \
  node backend/tools/benchmark-five-years.cjs
```

The default dataset contains ten properties, ten staff per property, 100 bills
per property per day, five lines per bill, attendance, personal commissions,
instructor/photo credit relationships, discounts, tips, and active/rebated/deleted
bills. Dates run from 2021-11-09 through 2026-11-08: 1,826 days, 1,826,000 bills,
9,130,000 bill items and 182,600 attendance records. Synthetic names and fixed
activity mixes are used; this is not production data or a forecast of its exact
distribution.

The benchmark records the Git revision and compares the original bill/dashboard
code at that revision without the new indexes against the working implementation
with the new indexes, using the same data. Before rerunning after committing the
implementation, set `BENCHMARK_BASELINE_REVISION` to the original baseline revision; otherwise
HEAD would already include the optimization and would not be a valid baseline.

Each case runs in a fresh process with a 384 MB JavaScript heap limit. That limit
does not cap total process RSS and does not emulate Docker's 512 MB backend memory
limit. PostgreSQL buffer/work memory and host information are saved with results.
The first sample is a connected-client first request; subsequent samples reuse
database/OS caches. No OS cache flush or production network latency is simulated.
Results include database reads, report calculation and JSON serialization or
PDF/XLSX creation. Express authentication/proxy processing and network transfer
are excluded. The concurrency case runs four property-dashboard operations at once.

Outputs are written to `outputs/five-year-benchmark/results.json` and
`query-plans.json`. Monthly financial, category and staff commission results are
compared against the original implementation, and bill count/net revenue are
checked independently with SQL aggregation. Long-period failures, timeouts and
heap exhaustion are recorded as failures, not timing estimates. The existing
global-dashboard API still limits requests to 366 days.

The synthetic schema is retained for repeatability; `--resume` reuses it. Only
this benchmark's ten indexes are removed/recreated for the baseline comparison.
Stop the isolated PostgreSQL instance after the measurements. Remove its temporary
cluster when results no longer need reproducing.

## Remaining work

These changes bound bill-list responses and avoid a duplicate dashboard dataset.
They do not make five-year detailed payroll calculations bounded-memory. Broad
reports still materialize their period's active bills and personal-payment detail.
Report/export workers, daily summaries and incremental commission aggregation
remain separate follow-up work if the measurements justify them.

Substring search runs in PostgreSQL, but no trigram indexes are added in this
phase. Large unrestricted searches should be measured before choosing search
indexes or changing search semantics. No Redis cache, replica, partitioning or
database connection-limit change is introduced.
