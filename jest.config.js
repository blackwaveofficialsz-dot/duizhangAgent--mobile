module.exports = {
  preset: 'jest-expo',
  moduleNameMapper: {
    '^@/components/charts/EChart$': '<rootDir>/src/test/EChartMock.tsx',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^expo/fetch$': '<rootDir>/src/test/expoFetchMock.ts',
    '^expo-network$': '<rootDir>/src/test/expoNetworkMock.ts',
    '^lucide-react-native$': '<rootDir>/src/test/lucideMock.tsx',
    '^react-native-gesture-handler/ReanimatedSwipeable$': '<rootDir>/src/test/ReanimatedSwipeableMock.tsx',
  },
};
