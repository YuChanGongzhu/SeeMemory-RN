import React, {useState} from 'react';
import {
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {CheckSquare, ShieldCheck, Square} from 'lucide-react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {localizedVendors, PRIVACY_POLICY_URL} from '../config/legal';
import {colors} from '../design/tokens';
import {t} from '../i18n/consentStrings';
import type {AIConsentPromptContext} from '../privacy/aiConsentController';

interface AIConsentDisclosureProps {
  context?: AIConsentPromptContext | null;
  /** per-action 弹窗需要用户显式勾选确认后才能同意；开屏告知页不需要。 */
  requireCheck?: boolean;
  agreeLabel: string;
  declineLabel: string;
  busy?: boolean;
  error?: string | null;
  onAgree: () => void;
  onDecline: () => void;
}

export function AIConsentDisclosure({
  context,
  requireCheck = false,
  agreeLabel,
  declineLabel,
  busy = false,
  error,
  onAgree,
  onDecline,
}: AIConsentDisclosureProps) {
  const insets = useSafeAreaInsets();
  const [checked, setChecked] = useState(false);
  const vendors = localizedVendors();
  const agreeDisabled = busy || (requireCheck && !checked);

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.body,
          {paddingTop: insets.top + 28, paddingBottom: 28},
        ]}
        showsVerticalScrollIndicator={false}>
        <View style={styles.iconWrap}>
          <ShieldCheck size={28} color={colors.textMain} />
        </View>
        <Text style={styles.title}>{t('ai.title')}</Text>
        <Text style={styles.lead}>{t('ai.lead')}</Text>

        {context ? (
          <View style={styles.actionNotice}>
            <Text style={styles.actionTitle}>{t('ai.actionSend')}</Text>
            <Text style={styles.actionText}>{context.data}</Text>
            <Text style={styles.actionTitle}>{t('ai.actionFor')}</Text>
            <Text style={styles.actionText}>{context.purpose}</Text>
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>{t('ai.dataTitle')}</Text>
        <Text style={styles.paragraph}>{t('ai.dataBody')}</Text>

        <Text style={styles.sectionTitle}>{t('ai.vendorTitle')}</Text>
        <View style={styles.vendorList}>
          {vendors.map((vendor, index) => (
            <View
              key={vendor.vendor}
              style={[
                styles.vendorRow,
                index < vendors.length - 1 && styles.vendorBorder,
              ]}>
              <Text style={styles.vendorName}>{vendor.vendor}</Text>
              <Text style={styles.vendorDetail}>
                {vendor.data} · {vendor.purpose}
              </Text>
            </View>
          ))}
        </View>

        <Text style={styles.paragraph}>{t('ai.noTraining')}</Text>

        <TouchableOpacity onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}>
          <Text style={styles.link}>{t('ai.readPolicy')}</Text>
        </TouchableOpacity>

        {requireCheck ? (
          <TouchableOpacity
            style={styles.checkRow}
            activeOpacity={0.7}
            onPress={() => setChecked(prev => !prev)}
            accessibilityRole="checkbox"
            accessibilityState={{checked}}>
            {checked ? (
              <CheckSquare size={22} color={colors.primary} />
            ) : (
              <Square size={22} color={colors.textSub} />
            )}
            <Text style={styles.checkText}>{t('ai.confirmCheckbox')}</Text>
          </TouchableOpacity>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      <View style={[styles.footer, {paddingBottom: insets.bottom + 16}]}>
        <TouchableOpacity
          style={[styles.agreeButton, agreeDisabled && styles.disabled]}
          onPress={onAgree}
          disabled={agreeDisabled}>
          <Text style={styles.agreeText}>{busy ? t('processing') : agreeLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.declineButton}
          onPress={onDecline}
          disabled={busy}>
          <Text style={styles.declineText}>{declineLabel}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.bgApp},
  body: {paddingHorizontal: 24},
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: {fontSize: 24, fontWeight: '700', color: colors.textMain, marginBottom: 12},
  lead: {fontSize: 15, lineHeight: 23, color: colors.textSub, marginBottom: 24},
  actionNotice: {
    backgroundColor: colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 16,
    marginBottom: 24,
  },
  actionTitle: {fontSize: 12, fontWeight: '700', color: colors.textSub, marginBottom: 4},
  actionText: {fontSize: 15, lineHeight: 22, color: colors.textMain, marginBottom: 12},
  sectionTitle: {fontSize: 16, fontWeight: '700', color: colors.textMain, marginBottom: 8},
  paragraph: {fontSize: 14, lineHeight: 22, color: colors.textSub, marginBottom: 20},
  vendorList: {
    backgroundColor: colors.bg,
    borderRadius: 8,
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  vendorRow: {paddingVertical: 12},
  vendorBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  vendorName: {fontSize: 14, fontWeight: '600', color: colors.textMain, marginBottom: 3},
  vendorDetail: {fontSize: 12, lineHeight: 18, color: colors.textSub},
  link: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMain,
    textDecorationLine: 'underline',
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 20,
  },
  checkText: {flex: 1, fontSize: 13, lineHeight: 20, color: colors.textMain},
  error: {fontSize: 13, lineHeight: 19, color: colors.danger, marginTop: 16},
  footer: {
    paddingHorizontal: 24,
    paddingTop: 12,
    backgroundColor: colors.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  agreeButton: {
    height: 52,
    backgroundColor: colors.primary,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {opacity: 0.6},
  agreeText: {fontSize: 16, fontWeight: '600', color: '#fff'},
  declineButton: {height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 4},
  declineText: {fontSize: 14, fontWeight: '600', color: colors.textSub},
});
