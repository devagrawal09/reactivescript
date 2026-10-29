import { Option, Schema } from 'effect'
import { Command, type Runtime, type Update } from 'foldkit'
import { Document, Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'

import * as Help from './help'
import * as Issues from './issues'
import * as Settings from './settings'

// MODEL

const Tab = Schema.Literals(['issues', 'help', 'settings'])
type Tab = typeof Tab.Type

// Each opening of a page gets a new `pageId`. Answers to a page that was left carry an old one and are dropped.
export const Page = defineTaggedUnion({
  Issues: { model: Issues.Model },
  Help: { model: Help.Model },
  Settings: { model: Settings.Model },
})

// The tab's open-issue count: the last one the issues page showed, kept while other pages are open.
export const Model = Schema.Struct({ pageId: Schema.Number, page: Page, maybeOpenCount: Schema.Option(Schema.Number) })
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  ClickedTab: { tab: Tab },
  GotIssuesMessage: { pageId: Schema.Number, message: Issues.Message },
  GotHelpMessage: { pageId: Schema.Number, message: Help.Message },
  GotSettingsMessage: { pageId: Schema.Number, message: Settings.Message },
})
export type Message = typeof Message.Type

// INIT

const openIssues = (
  maybeOpenCount: Option.Option<number>,
  pageId: number,
  result: Update.Return<Issues.Model, Issues.Message>,
): Update.Return<Model, Message> => ({
  model: {
    pageId,
    page: Page.Issues({ model: result.model }),
    maybeOpenCount: Option.orElse(Issues.openCount(result.model), () => maybeOpenCount),
  },
  commands: Command.mapMessages(result.commands, message => Message.GotIssuesMessage({ pageId, message })),
})

const openHelp = (
  maybeOpenCount: Option.Option<number>,
  pageId: number,
  result: Update.Return<Help.Model, Help.Message>,
): Update.Return<Model, Message> => ({
  model: { pageId, page: Page.Help({ model: result.model }), maybeOpenCount },
  commands: Command.mapMessages(result.commands, message => Message.GotHelpMessage({ pageId, message })),
})

const openSettings = (
  maybeOpenCount: Option.Option<number>,
  pageId: number,
  result: Update.Return<Settings.Model, Settings.Message>,
): Update.Return<Model, Message> => ({
  model: { pageId, page: Page.Settings({ model: result.model }), maybeOpenCount },
  commands: Command.mapMessages(result.commands, message => Message.GotSettingsMessage({ pageId, message })),
})

export const init: Runtime.ApplicationInit<Model, Message> = () => openIssues(Option.none(), 1, Issues.init())

// UPDATE

const tabOf = (page: typeof Page.Type): Tab =>
  Page.match<Tab>(page, { Issues: () => 'issues', Help: () => 'help', Settings: () => 'settings' })

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    ClickedTab: ({ tab }) => {
      if (tab === tabOf(model.page)) {
        return { model }
      }
      const pageId = model.pageId + 1
      return tab === 'issues'
        ? openIssues(model.maybeOpenCount, pageId, Issues.init())
        : tab === 'help'
          ? openHelp(model.maybeOpenCount, pageId, Help.init())
          : openSettings(model.maybeOpenCount, pageId, Settings.init())
    },

    GotIssuesMessage: ({ pageId, message }) =>
      model.page._tag === 'Issues' && pageId === model.pageId
        ? openIssues(model.maybeOpenCount, pageId, Issues.update(model.page.model, message))
        : { model },

    GotHelpMessage: ({ pageId, message }) =>
      model.page._tag === 'Help' && pageId === model.pageId
        ? openHelp(model.maybeOpenCount, pageId, Help.update(model.page.model, message))
        : { model },

    GotSettingsMessage: ({ pageId, message }) =>
      model.page._tag === 'Settings' && pageId === model.pageId
        ? openSettings(model.maybeOpenCount, pageId, Settings.update(model.page.model, message))
        : { model },
  })

// VIEW

const pageView = (model: Model, h: HtmlBuilder<Message>): Html =>
  Page.match(model.page, {
    Issues: page =>
      h.submodel({
        slotId: `issues-${model.pageId}`,
        model: page.model,
        view: Issues.view,
        toParentMessage: message => Message.GotIssuesMessage({ pageId: model.pageId, message }),
      }),
    Help: page =>
      h.submodel({
        slotId: `help-${model.pageId}`,
        model: page.model,
        view: Help.view,
        toParentMessage: message => Message.GotHelpMessage({ pageId: model.pageId, message }),
      }),
    Settings: page =>
      h.submodel({
        slotId: `settings-${model.pageId}`,
        model: page.model,
        view: Settings.view,
        toParentMessage: message => Message.GotSettingsMessage({ pageId: model.pageId, message }),
      }),
  })

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: 'Issue desk',
  body: h.div([], [
    h.nav([], [
      h.button([h.DataAttribute('testid', 'tab-issues'), h.OnClick(Message.ClickedTab({ tab: 'issues' }))], [
        Option.match(model.maybeOpenCount, { onNone: () => 'Issues', onSome: count => `Issues (${count})` }),
      ]),
      h.button([h.DataAttribute('testid', 'tab-help'), h.OnClick(Message.ClickedTab({ tab: 'help' }))], ['Help']),
      h.button([h.DataAttribute('testid', 'tab-settings'), h.OnClick(Message.ClickedTab({ tab: 'settings' }))], ['Settings']),
    ]),
    pageView(model, h),
  ]),
})
