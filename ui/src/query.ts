// A minimal `useQuery` shim standing in for `@tanstack/react-query` (the canvas
// used it for one read: the installed-skills list). No QueryClient/provider, no
// cache — it runs `queryFn` in an effect keyed by the JSON-serialized `queryKey`
// and exposes the `{ data, isPending, error }` subset the call-site reads. This
// is the spec's "replace react-query with useEffect+useState" for the sandbox.

import { useEffect, useRef, useState } from "react";

export function useQuery<T>(opts: {
	queryKey: unknown[];
	queryFn: () => Promise<T>;
	staleTime?: number;
	retry?: boolean | number;
}): { data: T | undefined; error: unknown; isPending: boolean } {
	const [data, setData] = useState<T | undefined>(undefined);
	const [error, setError] = useState<unknown>(null);
	const [isPending, setIsPending] = useState(true);
	const fnRef = useRef(opts.queryFn);
	fnRef.current = opts.queryFn;
	const key = JSON.stringify(opts.queryKey);

	useEffect(() => {
		let alive = true;
		setIsPending(true);
		fnRef
			.current()
			.then((v) => {
				if (alive) {
					setData(v);
					setError(null);
				}
			})
			.catch((e) => {
				if (alive) {
					setError(e);
				}
			})
			.finally(() => {
				if (alive) {
					setIsPending(false);
				}
			});
		return () => {
			alive = false;
		};
	}, [key]);

	return { data, error, isPending };
}
