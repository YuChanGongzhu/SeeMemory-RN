import React, {useState} from 'react';
import {
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {ChevronLeft, ExternalLink, ShieldCheck} from 'lucide-react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {localizedVendors, PRIVACY_POLICY_URL} from '../config/legal';
import {colors} from '../design/tokens';
import {t} from '../i18n/consentStrings';
import {useNav} from '../navigation/nav';
import {useAIConsent} from '../privacy/AIConsentContext';

export function PrivacyAIPage() {
  const nav = useNav();
  const insets = useSafeAreaInsets();
  const {state, grantAiConsent, withdrawAiConsent} = useAIConsent();
  const granted = state.decision === 'granted';
  const vendors = localizedVendors();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorSaveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const confirmWithdraw = () => {
    Alert.alert(t('priv.withdrawTitle'), t('priv.withdrawBody'), [
      {text: t('cancel'), style: 'cancel'},
      {
        text: t('priv.withdrawConfirm'),
        style: 'destructive',
        onPress: () => void run(withdrawAiConsent),
      },
    ]);
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, {paddingTop: insets.top + 8}]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={nav.pop}
          accessibilityLabel={t('priv.back')}>
          <ChevronLeft size={26} color={colors.textMain} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('priv.pageTitle')}</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.statusRow}>
          <ShieldCheck size={24} color={granted ? colors.primary : colors.textSub} />
          <View style={styles.statusCopy}>
            <Text style={styles.statusTitle}>{t('priv.statusTitle')}</Text>
            <Text style={[styles.statusValue, granted && styles.statusGranted]}>
              {granted ? t('priv.granted') : t('priv.notGranted')}
            </Text>
          </View>
        </View>

        <Text style={styles.paragraph}>{t('priv.intro')}</Text>

        <Text style={styles.sectionTitle}>{t('priv.dataTitle')}</Text>
        <Text style={styles.paragraph}>{t('priv.dataBody')}</Text>

        <Text style={styles.sectionTitle}>{t('priv.vendorTitle')}</Text>
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

        <Text style={styles.paragraph}>{t('priv.vendorNote')}</Text>

        <TouchableOpacity
          style={styles.policyLink}
          onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}>
          <Text style={styles.policyText}>{t('priv.fullPolicy')}</Text>
          <ExternalLink size={16} color={colors.textMain} />
        </TouchableOpacity>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.actionButton, granted && styles.withdrawButton, busy && styles.disabled]}
          disabled={busy}
          onPress={granted ? confirmWithdraw : () => void run(grantAiConsent)}>
          <Text style={[styles.actionText, granted && styles.withdrawText]}>
            {busy
              ? t('processing')
              : granted
                ? t('priv.withdrawButton')
                : t('priv.grantButton')}
          </Text>
        </TouchableOpacity>

        <Text style={styles.footnote}>{t('priv.footnote')}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.bgApp},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: colors.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  backButton: {width: 40, height: 40, alignItems: 'center', justifyContent: 'center'},
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '700',
    color: colors.textMain,
  },
  body: {padding: 20, paddingBottom: 44},
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    marginBottom: 20,
  },
  statusCopy: {flex: 1},
  statusTitle: {fontSize: 16, fontWeight: '700', color: colors.textMain},
  statusValue: {fontSize: 13, color: colors.textSub, marginTop: 4},
  statusGranted: {color: colors.primary, fontWeight: '700'},
  sectionTitle: {fontSize: 16, fontWeight: '700', color: colors.textMain, marginBottom: 8},
  paragraph: {fontSize: 14, lineHeight: 22, color: colors.textSub, marginBottom: 22},
  vendorList: {backgroundColor: colors.bg, borderRadius: 8, paddingHorizontal: 16, marginBottom: 22},
  vendorRow: {paddingVertical: 12},
  vendorBorder: {borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border},
  vendorName: {fontSize: 14, fontWeight: '600', color: colors.textMain, marginBottom: 3},
  vendorDetail: {fontSize: 12, lineHeight: 18, color: colors.textSub},
  policyLink: {flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12},
  policyText: {fontSize: 15, fontWeight: '600', color: colors.textMain},
  error: {fontSize: 13, lineHeight: 19, color: colors.danger, marginTop: 12},
  actionButton: {
    height: 52,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    marginTop: 24,
  },
  withdrawButton: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  disabled: {opacity: 0.6},
  actionText: {fontSize: 16, fontWeight: '700', color: '#fff'},
  withdrawText: {color: colors.danger},
  footnote: {fontSize: 12, lineHeight: 18, color: colors.textSub, marginTop: 14},
});
