import { buildListItemHtml } from './list-render';

describe('buildListItemHtml', () => {
  it('returns a single default "List item" when text is empty', () => {
    const out = buildListItemHtml('');
    expect(out).toContain('List item');
    const matches = out.match(/<div class="list-item level-0">/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('emits one div per newline-separated line', () => {
    const out = buildListItemHtml('one\ntwo\nthree');
    const matches = out.match(/<div class="list-item level-/g) ?? [];
    expect(matches.length).toBe(3);
    expect(out).toContain('>one<');
    expect(out).toContain('>two<');
    expect(out).toContain('>three<');
  });

  it('assigns level 0 with no leading tabs', () => {
    const out = buildListItemHtml('flat');
    expect(out).toContain('class="list-item level-0"');
    expect(out).toContain('\u2022'); // • bullet
  });

  it('assigns level 1 with a single leading tab', () => {
    const out = buildListItemHtml('\tnested');
    expect(out).toContain('class="list-item level-1"');
    expect(out).toContain('\u25E6'); // ◦ bullet
    expect(out).toContain('>nested<');
  });

  it('assigns level 2 with two leading tabs', () => {
    const out = buildListItemHtml('\t\tdeep');
    expect(out).toContain('class="list-item level-2"');
    expect(out).toContain('\u25AA'); // ▪ bullet
    expect(out).toContain('>deep<');
  });

  it('caps nesting at level 2 regardless of tab count', () => {
    const out = buildListItemHtml('\t\t\t\t\t\ttoo-deep');
    expect(out).toContain('class="list-item level-2"');
    expect(out).not.toContain('level-3');
    expect(out).not.toContain('level-6');
    expect(out).toContain('>too-deep<');
  });

  it('escapes < > & " and single-quote characters', () => {
    const out = buildListItemHtml(`<script>alert("x & y")</script>`);
    expect(out).toContain('&lt;script&gt;');
    expect(out).toContain('alert(&quot;x &amp; y&quot;)');
    expect(out).toContain('&lt;/script&gt;');
    expect(out).not.toContain('<script>');
  });

  it('escapes single-quote to &#39;', () => {
    const out = buildListItemHtml("it's");
    expect(out).toContain('it&#39;s');
    expect(out).not.toContain("it's<");
  });

  it('renders empty lines as &nbsp; content', () => {
    const out = buildListItemHtml('first\n\nthird');
    // Middle line: empty content after tab-slicing → &nbsp;
    expect(out).toContain('<span class="list-text">&nbsp;</span>');
  });

  it('uses correct bullet characters for each level', () => {
    const out = buildListItemHtml('a\n\tb\n\t\tc');
    expect(out).toContain('<span class="bullet">\u2022</span>');
    expect(out).toContain('<span class="bullet">\u25E6</span>');
    expect(out).toContain('<span class="bullet">\u25AA</span>');
  });
});
