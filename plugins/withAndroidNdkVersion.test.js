const plugin = require('./withAndroidNdkVersion');

describe('withAndroidNdkVersion', () => {
  it('adds one inherited NDK override to the root Gradle file', () => {
    const input = 'apply plugin: "expo-root-project"\n';
    const output = plugin.applyAndroidNdkOverride(input);

    expect(output).toMatch(/subproject\.plugins\.withId\('com\.android\.library'\)/);
    expect(output).toMatch(/subproject\.extensions\.getByName\('android'\)\.ndkVersion = rootProject\.ext\.ndkVersion/);
    expect(plugin.applyAndroidNdkOverride(output)).toBe(output);
  });
});
