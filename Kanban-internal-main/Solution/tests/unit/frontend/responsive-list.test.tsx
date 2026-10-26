// B01 — ResponsiveList switches <table> / <ul> at 640 px (TC-034). Rendered with
// react-dom/server against a stubbed matchMedia (no DOM environment needed).
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { ResponsiveList, type Column } from '../../../frontend/src/components';

type Row = { id: string; name: string; days: string };
const columns: Column<Row>[] = [
  { key: 'name', header: 'Name', cell: (r) => r.name },
  { key: 'days', header: 'Days', cell: (r) => r.days, numeric: true },
];
const rows: Row[] = [{ id: '1', name: 'Earned', days: '9.0' }];

function stubViewport(width: number) {
  const mql = (query: string) => {
    const m = /min-width:\s*(\d+)px/.exec(query);
    return {
      matches: m ? width >= Number(m[1]) : false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
  };
  (globalThis as unknown as { window: unknown }).window = { matchMedia: mql };
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

function render() {
  return renderToStaticMarkup(
    <ResponsiveList columns={columns} rows={rows} rowKey={(r) => r.id} emptyText="Nothing yet" />,
  );
}

describe('TC-034 ResponsiveList switches table/cards at 640 px', () => {
  it('width 639 → <ul> card list', () => {
    stubViewport(639);
    const html = render();
    expect(html).toMatch(/^<ul/);
    expect(html).not.toContain('<table');
    expect(html).toContain('Earned');
  });
  it('width 640 → <table>', () => {
    stubViewport(640);
    const html = render();
    expect(html).toContain('<table');
    expect(html).not.toContain('<ul');
    expect(html).toContain('<th scope="col"');
    expect(html).toContain('Earned');
  });
  it('empty rows render one row / one card carrying the empty text', () => {
    stubViewport(1024);
    const table = renderToStaticMarkup(
      <ResponsiveList
        columns={columns}
        rows={[]}
        rowKey={(r: Row) => r.id}
        emptyText="Nothing yet"
      />,
    );
    expect(table).toMatch(/colspan="2"/i);
    expect(table).toContain('Nothing yet');
    stubViewport(390);
    const cards = renderToStaticMarkup(
      <ResponsiveList
        columns={columns}
        rows={[]}
        rowKey={(r: Row) => r.id}
        emptyText="Nothing yet"
      />,
    );
    expect(cards).toMatch(/<ul[^>]*><li[^>]*>Nothing yet<\/li><\/ul>/);
  });
});
