import { semanticThemes } from './tokens';

describe('semanticThemes', () => {
  it('matches the confirmed mobile redesign palette', () => {
    expect(semanticThemes.light.background.canvas).toBe('#F5F7F8');
    expect(semanticThemes.light.background.surface).toBe('#FFFFFF');
    expect(semanticThemes.light.background.subtle).toBe('#EDF1F2');
    expect(semanticThemes.light.text.muted).toBe('#5F6B76');
    expect(semanticThemes.light.action.primary).toBe('#087E6D');
    expect(semanticThemes.light.status.success).toBe('#087E6D');
    expect(semanticThemes.light.status.danger).toBe('#D9492B');
    expect(semanticThemes.light.status.warning).toBe('#A76500');

    expect(semanticThemes.dark.background.canvas).toBe('#111C25');
    expect(semanticThemes.dark.background.surface).toBe('#18242E');
    expect(semanticThemes.dark.background.subtle).toBe('#1E2C37');
    expect(semanticThemes.dark.text.muted).toBe('#8C98A4');
    expect(semanticThemes.dark.action.primary).toBe('#2563EB');
    expect(semanticThemes.dark.status.success).toBe('#20C6A3');
    expect(semanticThemes.dark.status.danger).toBe('#FF5A36');
    expect(semanticThemes.dark.status.warning).toBe('#F2B84B');
  });
});
