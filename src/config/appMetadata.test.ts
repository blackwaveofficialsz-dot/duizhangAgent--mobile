import appConfig from '../../app.json';
import easConfig from '../../eas.json';

describe('app metadata', () => {
  it('uses the approved mobile display name and BW logo icon', () => {
    const expo = appConfig.expo;
    const iconPath = './assets/images/BWlogoicon.png';

    expect(expo.name).toBe('寰澜BW');
    expect(expo.icon).toBe(iconPath);
    expect(expo.ios?.icon).toBe(iconPath);
    expect(expo.android?.adaptiveIcon?.foregroundImage).toBe(iconPath);
  });

  it('targets the existing EAS project with the next TestFlight build number', () => {
    const expo = appConfig.expo;

    expect(expo.owner).toBe('blackwaveofficials-team');
    expect(expo.extra?.eas?.projectId).toBe('754f7bac-e388-40a2-9972-3d417c0930ef');
    expect(expo.ios?.buildNumber).toBe('3');
    expect(easConfig.cli?.appVersionSource).toBe('local');
  });

  it('submits internal iOS builds to the existing App Store Connect app', () => {
    expect(easConfig.submit?.['internal-ios']?.ios?.ascAppId).toBe('6802892409');
  });
});
