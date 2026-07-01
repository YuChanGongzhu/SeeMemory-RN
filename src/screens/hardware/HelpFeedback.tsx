/** 帮助与反馈 —— 静态入口行。 */
import React from 'react';
import {Alert, ScrollView, StyleSheet, View} from 'react-native';
import {SubHeader, Card, MenuRow, HW} from './parts';

const ITEMS = ['常见问题', '使用教程', '意见反馈', '联系客服'];

export function HelpFeedback({onBack}: {onBack: () => void}) {
  return (
    <View style={st.root}>
      <SubHeader title="帮助与反馈" onBack={onBack} />
      <ScrollView contentContainerStyle={st.body} showsVerticalScrollIndicator={false}>
        <Card>
          {ITEMS.map((label, i) => (
            <MenuRow key={label} label={label} onPress={() => Alert.alert(label)} last={i === ITEMS.length - 1} />
          ))}
        </Card>
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  root: {flex: 1, backgroundColor: HW.pageBg},
  body: {padding: 20},
});
