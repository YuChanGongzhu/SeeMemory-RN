import React from 'react';
import {View, Text, TextInput, StyleSheet} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Menu, ChevronLeft, Sparkles} from 'lucide-react-native';
import {colors, type as T, radius} from '../design/tokens';
import {IconButton} from './kit';
import {TourTarget} from '../onboarding/TourTarget';
import {useTour} from '../onboarding/TourContext';

/** Home hub header: hamburger (opens drawer) + frosted "搜索记忆" search input + optional right slot. */
export function HomeHeader({
  onOpenDrawer,
  query,
  onChangeQuery,
  right,
}: {
  onOpenDrawer: () => void;
  query?: string;
  onChangeQuery?: (q: string) => void;
  right?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const tour = useTour();
  return (
    <View style={[styles.home, {paddingTop: insets.top + 8}]}>
      <TourTarget id="drawer-open">
        <IconButton
          onPress={() => {
            onOpenDrawer();
            tour.notifyPress('drawer-open');
          }}
          bg="transparent"
          size={38}>
          <Menu size={26} color={colors.textMain} strokeWidth={1.9} />
        </IconButton>
      </TourTarget>
      <View style={styles.search}>
        <Sparkles size={16} color={colors.textSub} />
        <TextInput
          style={styles.searchInput}
          placeholder="搜索记忆"
          placeholderTextColor={colors.textSub}
          value={query}
          onChangeText={onChangeQuery}
          returnKeyType="search"
        />
      </View>
      {right}
    </View>
  );
}

/** Full-page header: back arrow + centered title. `dark` for dark sub-pages. */
export function PageHeader({
  title,
  onBack,
  right,
  dark,
}: {
  title: string;
  onBack: () => void;
  right?: React.ReactNode;
  dark?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const fg = dark ? colors.onDark : colors.textMain;
  return (
    <View
      style={[
        styles.page,
        {
          paddingTop: insets.top + 8,
          backgroundColor: dark ? colors.dark : 'rgba(249,249,251,0.92)',
          borderBottomColor: dark ? 'rgba(255,255,255,0.08)' : colors.border,
        },
      ]}>
      <IconButton onPress={onBack} bg={dark ? 'rgba(255,255,255,0.1)' : colors.bgSecondary} size={38}>
        <ChevronLeft size={22} color={fg} strokeWidth={2} />
      </IconButton>
      <Text style={[styles.pageTitle, {color: fg}]} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.right}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  home: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 10,
  },
  search: {
    flex: 1,
    height: 44,
    borderRadius: radius.lg,
    backgroundColor: colors.bgSecondary,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    color: colors.textMain,
    fontSize: 15,
    padding: 0,
  },
  page: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pageTitle: {
    flex: 1,
    textAlign: 'center',
    ...(T.sysTitle as object),
  },
  right: {minWidth: 38, alignItems: 'flex-end'},
});
