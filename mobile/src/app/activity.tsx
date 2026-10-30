import { useState } from "react";

import { Timeline } from "@/components/Timeline";
import { Button, Card, Empty, ErrorState, Loading, Screen, TopBar } from "@/components/ui";
import { api, type AuditEvent } from "@/lib/api";
import { useLoad } from "@/lib/hooks";

export default function Activity() {
  const { data, setData, error, loading, refreshing, reload } = useLoad(() => api.audit());
  const [more, setMore] = useState(false);

  const loadMore = async () => {
    if (!data?.next_cursor) return;
    setMore(true);
    try {
      const page = await api.audit(data.next_cursor);
      setData({ items: [...data.items, ...page.items] as AuditEvent[], next_cursor: page.next_cursor });
    } finally {
      setMore(false);
    }
  };

  return (
    <Screen refreshing={refreshing} onRefresh={reload}>
      <TopBar title="Activity history" />
      {loading && !data ? <Loading /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : !data?.items.length ? (
        <Empty icon="time-outline" title="No activity yet" body="Every plan, approval and adapter call is logged here." />
      ) : (
        <>
          <Card><Timeline events={data.items} showTask /></Card>
          {data.next_cursor && <Button label="Load more" kind="secondary" small loading={more} onPress={loadMore} />}
        </>
      )}
    </Screen>
  );
}
