// Knowledge lists use paginated API responses even when the screen shows one list.
export async function fetchList<T>(path: string): Promise<T[]> {
  const result: T[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const response = await fetch(`${path}${path.includes("?") ? "&" : "?"}page=${page}&limit=100`, { cache: "no-store" });
    if (!response.ok) throw new Error("A tudásbázis nem tölthető be. Próbáld újra.");
    const body = await response.json();
    if (!Array.isArray(body.data) || !Number.isInteger(body.pagination?.totalPages) || body.pagination.totalPages < 0) {
      throw new Error("A tudásbázis válasza nem megfelelő formátumú.");
    }
    result.push(...body.data);
    totalPages = body.pagination.totalPages;
    page++;
  } while (page <= totalPages);
  return result;
}
