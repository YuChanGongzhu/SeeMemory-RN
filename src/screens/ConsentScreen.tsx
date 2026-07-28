import React, {useState} from 'react';
import {
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {ShieldCheck} from 'lucide-react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {PRIVACY_POLICY_URL} from '../config/legal';
import {colors} from '../design/tokens';
import {t} from '../i18n/consentStrings';

export function PrivacyConsentScreen({onAgree}: {onAgree: () => Promise<void>}) {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const agree = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await onAgree();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t('base.saveFailed'));
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.body,
          {paddingTop: insets.top + 32, paddingBottom: 24},
        ]}>
        <View style={styles.iconWrap}>
          <ShieldCheck size={28} color={colors.textMain} />
        </View>
        <Text style={styles.title}>{t('base.title')}</Text>
        <Text style={styles.lead}>{t('base.lead')}</Text>

        <Text style={styles.sectionTitle}>{t('base.dataTitle')}</Text>
        <Text style={styles.paragraph}>{t('base.dataBody')}</Text>

        <Text style={styles.sectionTitle}>{t('base.aiTitle')}</Text>
        <Text style={styles.paragraph}>{t('base.aiBody')}</Text>

        <TouchableOpacity onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}>
          <Text style={styles.link}>{t('base.readPolicy')}</Text>
        </TouchableOpacity>
        {message ? <Text style={styles.message}>{message}</Text> : null}
      </ScrollView>

      <View style={[styles.footer, {paddingBottom: insets.bottom + 16}]}>
        <TouchableOpacity
          style={[styles.agreeButton, busy && styles.disabled]}
          onPress={() => void agree()}
          disabled={busy}>
          <Text style={styles.agreeText}>
            {busy ? t('processing') : t('base.agree')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.declineButton}
          onPress={() => setMessage(t('base.disagreeMsg'))}>
          <Text style={styles.declineText}>{t('base.disagree')}</Text>
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
  lead: {fontSize: 15, lineHeight: 23, color: colors.textSub, marginBottom: 28},
  sectionTitle: {fontSize: 16, fontWeight: '700', color: colors.textMain, marginBottom: 8},
  paragraph: {fontSize: 14, lineHeight: 22, color: colors.textSub, marginBottom: 20},
  link: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMain,
    textDecorationLine: 'underline',
  },
  message: {fontSize: 13, lineHeight: 19, color: colors.danger, marginTop: 16},
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
