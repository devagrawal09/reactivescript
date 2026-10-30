import { Array, Effect, Option, Schema, pipe } from 'effect'
import { Command, Submodel, type Update } from 'foldkit'
import { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'

import * as Api from './api'
import { request } from './request'

// MODEL

const Filter = Schema.Literals(['open', 'closed'])
type Filter = typeof Filter.Type

const Issue = Schema.Struct({ id: Schema.Number, title: Schema.String, assignee: Schema.NullOr(Schema.String) })
type Issue = typeof Issue.Type
const Detail = Schema.Struct({ id: Schema.Number, title: Schema.String, body: Schema.String })
const Comment = Schema.Struct({ author: Schema.String, text: Schema.String })

export const ListState = defineTaggedUnion({
  Loading: {},
  Loaded: { issues: Schema.Array(Issue) },
  Failed: { error: Schema.String },
})
export const DetailState = defineTaggedUnion({
  Loading: {},
  Loaded: { detail: Detail },
  Failed: { error: Schema.String },
})
export const CommentsState = defineTaggedUnion({
  Loading: {},
  Loaded: { comments: Schema.Array(Comment) },
  Failed: { error: Schema.String },
})

// A write still in the air. `seq` orders writes: the newest guess for an issue is what it shows.
const Guess = Schema.Struct({ seq: Schema.Number, id: Schema.Number, value: Schema.String })
type Guess = typeof Guess.Type
const Sending = Schema.Struct({ seq: Schema.Number, id: Schema.Number, author: Schema.String, text: Schema.String })
// An error that belongs to one issue: shown only while that issue is selected.
const IssueError = Schema.Struct({ id: Schema.Number, message: Schema.String })
type IssueError = typeof IssueError.Type
// The newest write of a kind that the server confirmed, per issue.
const Confirmed = Schema.Struct({ id: Schema.Number, seq: Schema.Number })
type Confirmed = typeof Confirmed.Type

export const Model = Schema.Struct({
  user: Schema.String,
  filter: Filter,
  listSeq: Schema.Number,
  list: ListState,
  maybeSelected: Schema.Option(Schema.Number),
  detailSeq: Schema.Number,
  detail: DetailState,
  comments: CommentsState,
  seq: Schema.Number,
  assigning: Schema.Array(Guess),
  confirmedAssigns: Schema.Array(Confirmed),
  lastAssign: Schema.Number,
  maybeAssignError: Schema.Option(IssueError),
  titleInput: Schema.String,
  renaming: Schema.Array(Guess),
  confirmedRenames: Schema.Array(Confirmed),
  lastRename: Schema.Number,
  maybeRenameError: Schema.Option(IssueError),
  closing: Schema.Array(Schema.Struct({ seq: Schema.Number, id: Schema.Number })),
  lastClose: Schema.Number,
  maybeCloseError: Schema.Option(IssueError),
  commentInput: Schema.String,
  sending: Schema.Array(Sending),
  lastPost: Schema.Number,
  maybePostError: Schema.Option(IssueError),
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  UpdatedUser: { value: Schema.String },
  ClickedFilter: { filter: Filter },
  SucceededFetchIssues: { seq: Schema.Number, issues: Schema.Array(Issue) },
  FailedFetchIssues: { seq: Schema.Number, error: Schema.String },
  ClickedIssue: { id: Schema.Number },
  ClickedRetry: {},
  SucceededFetchIssue: { seq: Schema.Number, detail: Schema.NullOr(Detail) },
  FailedFetchIssue: { seq: Schema.Number, error: Schema.String },
  SucceededFetchComments: { seq: Schema.Number, comments: Schema.Array(Comment) },
  FailedFetchComments: { seq: Schema.Number, error: Schema.String },
  ClickedAssign: {},
  SucceededAssign: { seq: Schema.Number, id: Schema.Number, assignee: Schema.String },
  FailedAssign: { seq: Schema.Number, id: Schema.Number, error: Schema.String },
  UpdatedTitleInput: { value: Schema.String },
  ClickedRename: {},
  SucceededRename: { seq: Schema.Number, id: Schema.Number, title: Schema.String },
  FailedRename: { seq: Schema.Number, id: Schema.Number, error: Schema.String },
  ClickedClose: {},
  SucceededClose: { seq: Schema.Number, id: Schema.Number },
  FailedClose: { seq: Schema.Number, id: Schema.Number, error: Schema.String },
  UpdatedCommentInput: { value: Schema.String },
  ClickedPost: {},
  SucceededPost: { seq: Schema.Number, id: Schema.Number, comment: Comment },
  FailedPost: { seq: Schema.Number, id: Schema.Number, error: Schema.String },
})
export type Message = typeof Message.Type

// COMMAND

const FetchIssues = Command.define('FetchIssues', {
  args: { seq: Schema.Number, filter: Filter },
  messages: [Message.SucceededFetchIssues, Message.FailedFetchIssues],
  execute: ({ seq, filter }) =>
    request(() => Api.fetchIssues(filter)).pipe(
      Effect.map(issues => Message.SucceededFetchIssues({ seq, issues })),
      Effect.catch(error => Effect.succeed(Message.FailedFetchIssues({ seq, error }))),
    ),
})

const FetchIssue = Command.define('FetchIssue', {
  args: { seq: Schema.Number, id: Schema.Number },
  messages: [Message.SucceededFetchIssue, Message.FailedFetchIssue],
  execute: ({ seq, id }) =>
    request(() => Api.fetchIssue(id)).pipe(
      Effect.map(detail => Message.SucceededFetchIssue({ seq, detail })),
      Effect.catch(error => Effect.succeed(Message.FailedFetchIssue({ seq, error }))),
    ),
})

const FetchComments = Command.define('FetchComments', {
  args: { seq: Schema.Number, id: Schema.Number },
  messages: [Message.SucceededFetchComments, Message.FailedFetchComments],
  execute: ({ seq, id }) =>
    request(() => Api.fetchComments(id)).pipe(
      Effect.map(comments => Message.SucceededFetchComments({ seq, comments })),
      Effect.catch(error => Effect.succeed(Message.FailedFetchComments({ seq, error }))),
    ),
})

const Assign = Command.define('Assign', {
  args: { seq: Schema.Number, id: Schema.Number, user: Schema.String },
  messages: [Message.SucceededAssign, Message.FailedAssign],
  execute: ({ seq, id, user }) =>
    request(() => Api.assign(id, user)).pipe(
      Effect.map(answer => Message.SucceededAssign({ seq, id, assignee: answer.assignee })),
      Effect.catch(error => Effect.succeed(Message.FailedAssign({ seq, id, error }))),
    ),
})

const Rename = Command.define('Rename', {
  args: { seq: Schema.Number, id: Schema.Number, title: Schema.String },
  messages: [Message.SucceededRename, Message.FailedRename],
  execute: ({ seq, id, title }) =>
    request(() => Api.renameIssue(id, title)).pipe(
      Effect.map(answer => Message.SucceededRename({ seq, id, title: answer.title })),
      Effect.catch(error => Effect.succeed(Message.FailedRename({ seq, id, error }))),
    ),
})

const Close = Command.define('Close', {
  args: { seq: Schema.Number, id: Schema.Number },
  messages: [Message.SucceededClose, Message.FailedClose],
  execute: ({ seq, id }) =>
    request(() => Api.closeIssue(id)).pipe(
      Effect.as(Message.SucceededClose({ seq, id })),
      Effect.catch(error => Effect.succeed(Message.FailedClose({ seq, id, error }))),
    ),
})

const Post = Command.define('Post', {
  args: { seq: Schema.Number, id: Schema.Number, author: Schema.String, text: Schema.String },
  messages: [Message.SucceededPost, Message.FailedPost],
  execute: ({ seq, id, author, text }) =>
    request(() => Api.addComment(id, author, text)).pipe(
      Effect.map(comment => Message.SucceededPost({ seq, id, comment })),
      Effect.catch(error => Effect.succeed(Message.FailedPost({ seq, id, error }))),
    ),
})

// INIT

export const init = (): Update.Return<Model, Message> => ({
  model: {
    user: 'guest',
    filter: 'open',
    listSeq: 1,
    list: ListState.Loading(),
    maybeSelected: Option.none(),
    detailSeq: 0,
    detail: DetailState.Loading(),
    comments: CommentsState.Loading(),
    seq: 1,
    assigning: [],
    confirmedAssigns: [],
    lastAssign: 0,
    maybeAssignError: Option.none(),
    titleInput: '',
    renaming: [],
    confirmedRenames: [],
    lastRename: 0,
    maybeRenameError: Option.none(),
    closing: [],
    lastClose: 0,
    maybeCloseError: Option.none(),
    commentInput: '',
    sending: [],
    lastPost: 0,
    maybePostError: Option.none(),
  },
  commands: [FetchIssues({ seq: 1, filter: 'open' })],
})

// UPDATE

const dropGuess =
  (seq: number) =>
  <A extends { readonly seq: number }>(guesses: ReadonlyArray<A>): ReadonlyArray<A> =>
    Array.filter(guesses, guess => guess.seq !== seq)

const latestGuess = (guesses: ReadonlyArray<Guess>, id: number): Option.Option<string> =>
  pipe(
    guesses,
    Array.filter(guess => guess.id === id),
    Array.last,
    Option.map(guess => guess.value),
  )

const confirmedSeq = (confirmed: ReadonlyArray<Confirmed>, id: number): number =>
  pipe(
    confirmed,
    Array.findFirst(entry => entry.id === id),
    Option.match({ onNone: () => 0, onSome: entry => entry.seq }),
  )

const confirm = (confirmed: ReadonlyArray<Confirmed>, id: number, seq: number): ReadonlyArray<Confirmed> => [
  ...Array.filter(confirmed, entry => entry.id !== id),
  { id, seq },
]

const mapIssue = (id: number, f: (issue: Issue) => Issue) => (list: typeof ListState.Type) =>
  ListState.match(list, {
    Loading: () => list,
    Failed: () => list,
    Loaded: ({ issues }) => ListState.Loaded({ issues: Array.map(issues, issue => (issue.id === id ? f(issue) : issue)) }),
  })

const isSelected = (model: Model, id: number) => Option.contains(model.maybeSelected, id)

// Only the newest write of a kind reports its failure.
const failure = (last: number, seq: number, id: number, message: string) => (current: Option.Option<IssueError>) =>
  last === seq ? Option.some({ id, message }) : current

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    UpdatedUser: ({ value }) => ({ model: modifyFields(model, { user: () => value }) }),

    ClickedFilter: ({ filter }) => {
      if (filter === model.filter) {
        return { model }
      }
      const listSeq = model.listSeq + 1
      return {
        model: modifyFields(model, { filter: () => filter, listSeq: () => listSeq, list: () => ListState.Loading() }),
        commands: [FetchIssues({ seq: listSeq, filter })],
      }
    },

    SucceededFetchIssues: ({ seq, issues }) =>
      seq === model.listSeq ? { model: modifyFields(model, { list: () => ListState.Loaded({ issues }) }) } : { model },

    FailedFetchIssues: ({ seq, error }) =>
      seq === model.listSeq ? { model: modifyFields(model, { list: () => ListState.Failed({ error }) }) } : { model },

    ClickedIssue: ({ id }) => {
      const cleared = modifyFields(model, {
        titleInput: () => '',
        maybeAssignError: () => Option.none(),
        maybeRenameError: () => Option.none(),
        maybeCloseError: () => Option.none(),
        maybePostError: () => Option.none(),
      })
      if (isSelected(model, id)) {
        return { model: cleared }
      }
      const detailSeq = model.detailSeq + 1
      return {
        model: modifyFields(cleared, {
          maybeSelected: () => Option.some(id),
          detailSeq: () => detailSeq,
          detail: () => DetailState.Loading(),
          comments: () => CommentsState.Loading(),
        }),
        commands: [FetchIssue({ seq: detailSeq, id }), FetchComments({ seq: detailSeq, id })],
      }
    },

    ClickedRetry: () =>
      Option.match(model.maybeSelected, {
        onNone: () => ({ model }),
        onSome: id => {
          const detailSeq = model.detailSeq + 1
          return {
            model: modifyFields(model, { detailSeq: () => detailSeq, detail: () => DetailState.Loading() }),
            commands: [FetchIssue({ seq: detailSeq, id })],
          }
        },
      }),

    SucceededFetchIssue: ({ seq, detail }) => {
      if (seq !== model.detailSeq) {
        return { model }
      }
      const id = Option.getOrElse(model.maybeSelected, () => 0)
      return {
        model: modifyFields(model, {
          detail: () =>
            detail === null ? DetailState.Failed({ error: `issue #${id} not found` }) : DetailState.Loaded({ detail }),
        }),
      }
    },

    FailedFetchIssue: ({ seq, error }) =>
      seq === model.detailSeq ? { model: modifyFields(model, { detail: () => DetailState.Failed({ error }) }) } : { model },

    SucceededFetchComments: ({ seq, comments }) =>
      seq === model.detailSeq
        ? { model: modifyFields(model, { comments: () => CommentsState.Loaded({ comments }) }) }
        : { model },

    FailedFetchComments: ({ seq, error }) =>
      seq === model.detailSeq ? { model: modifyFields(model, { comments: () => CommentsState.Failed({ error }) }) } : { model },

    ClickedAssign: () =>
      Option.match(model.maybeSelected, {
        onNone: () => ({ model }),
        onSome: id => ({
          model: modifyFields(model, {
            seq: seq => seq + 1,
            lastAssign: () => model.seq,
            maybeAssignError: () => Option.none(),
            assigning: Array.append({ seq: model.seq, id, value: model.user }),
          }),
          commands: [Assign({ seq: model.seq, id, user: model.user })],
        }),
      }),

    SucceededAssign: ({ seq, id, assignee }) => {
      const isNewest = confirmedSeq(model.confirmedAssigns, id) < seq
      return {
        model: modifyFields(model, {
          assigning: dropGuess(seq),
          confirmedAssigns: confirmed => (isNewest ? confirm(confirmed, id, seq) : confirmed),
          list: list => (isNewest ? mapIssue(id, issue => ({ ...issue, assignee }))(list) : list),
        }),
      }
    },

    FailedAssign: ({ seq, id, error }) => ({
      model: modifyFields(model, {
        assigning: dropGuess(seq),
        maybeAssignError: failure(model.lastAssign, seq, id, error),
      }),
    }),

    UpdatedTitleInput: ({ value }) => ({ model: modifyFields(model, { titleInput: () => value }) }),

    ClickedRename: () =>
      Option.match(model.maybeSelected, {
        onNone: () => ({ model }),
        onSome: id =>
          model.titleInput === ''
            ? { model }
            : {
                model: modifyFields(model, {
                  seq: seq => seq + 1,
                  lastRename: () => model.seq,
                  maybeRenameError: () => Option.none(),
                  renaming: Array.append({ seq: model.seq, id, value: model.titleInput }),
                }),
                commands: [Rename({ seq: model.seq, id, title: model.titleInput })],
              },
      }),

    SucceededRename: ({ seq, id, title }) => {
      const isNewest = confirmedSeq(model.confirmedRenames, id) < seq
      return {
        model: modifyFields(model, {
          renaming: dropGuess(seq),
          confirmedRenames: confirmed => (isNewest ? confirm(confirmed, id, seq) : confirmed),
          list: list => (isNewest ? mapIssue(id, issue => ({ ...issue, title }))(list) : list),
          detail: detail =>
            isNewest && detail._tag === 'Loaded' && detail.detail.id === id
              ? DetailState.Loaded({ detail: { ...detail.detail, title } })
              : detail,
        }),
      }
    },

    FailedRename: ({ seq, id, error }) => ({
      model: modifyFields(model, {
        renaming: dropGuess(seq),
        maybeRenameError: failure(model.lastRename, seq, id, error),
      }),
    }),

    ClickedClose: () =>
      Option.match(model.maybeSelected, {
        onNone: () => ({ model }),
        onSome: id => ({
          model: modifyFields(model, {
            seq: seq => seq + 1,
            lastClose: () => model.seq,
            maybeCloseError: () => Option.none(),
            closing: Array.append({ seq: model.seq, id }),
          }),
          commands: [Close({ seq: model.seq, id })],
        }),
      }),

    SucceededClose: ({ seq, id }) => ({
      model: modifyFields(model, {
        closing: dropGuess(seq),
        list: list =>
          model.filter === 'open' && list._tag === 'Loaded'
            ? ListState.Loaded({ issues: Array.filter(list.issues, issue => issue.id !== id) })
            : list,
      }),
    }),

    FailedClose: ({ seq, id, error }) => ({
      model: modifyFields(model, {
        closing: dropGuess(seq),
        maybeCloseError: failure(model.lastClose, seq, id, error),
      }),
    }),

    UpdatedCommentInput: ({ value }) => ({ model: modifyFields(model, { commentInput: () => value }) }),

    ClickedPost: () =>
      Option.match(model.maybeSelected, {
        onNone: () => ({ model }),
        onSome: id =>
          model.commentInput === ''
            ? { model }
            : {
                model: modifyFields(model, {
                  seq: seq => seq + 1,
                  lastPost: () => model.seq,
                  maybePostError: () => Option.none(),
                  commentInput: () => '',
                  sending: Array.append({ seq: model.seq, id, author: model.user, text: model.commentInput }),
                }),
                commands: [Post({ seq: model.seq, id, author: model.user, text: model.commentInput })],
              },
      }),

    SucceededPost: ({ seq, id, comment }) => ({
      model: modifyFields(model, {
        sending: dropGuess(seq),
        comments: comments =>
          isSelected(model, id) && comments._tag === 'Loaded'
            ? CommentsState.Loaded({ comments: Array.append(comments.comments, comment) })
            : comments,
      }),
    }),

    FailedPost: ({ seq, id, error }) => ({
      model: modifyFields(model, {
        sending: dropGuess(seq),
        maybePostError: failure(model.lastPost, seq, id, error),
      }),
    }),
  })

// VIEW

const testId = (h: HtmlBuilder<Message>, id: string) => h.DataAttribute('testid', id)

const shownIssues = (model: Model, issues: ReadonlyArray<Issue>): ReadonlyArray<Issue> =>
  pipe(
    issues,
    Array.filter(issue => !(model.filter === 'open' && Array.some(model.closing, closing => closing.id === issue.id))),
    Array.map(issue => ({
      ...issue,
      title: Option.getOrElse(latestGuess(model.renaming, issue.id), () => issue.title),
      assignee: Option.getOrElse(latestGuess(model.assigning, issue.id), () => issue.assignee),
    })),
  )

// The open list as shown (closes in flight already out of it). Other lists, loads and failures have no count.
export const openCount = (model: Model): Option.Option<number> =>
  model.filter === 'open' && model.list._tag === 'Loaded'
    ? Option.some(shownIssues(model, model.list.issues).length)
    : Option.none()

const listView = (model: Model, h: HtmlBuilder<Message>): Html =>
  ListState.match(model.list, {
    Loading: () => h.p([], [`loading ${model.filter} issues`]),
    Failed: ({ error }) => h.p([], [`list error: ${error}`]),
    Loaded: ({ issues }) =>
      h.ul(
        [],
        Array.map(shownIssues(model, issues), issue =>
          h.keyed('li')(String(issue.id), [], [
            h.button(
              [testId(h, 'issue'), h.OnClick(Message.ClickedIssue({ id: issue.id }))],
              [`#${issue.id} ${issue.title} (${issue.assignee ?? 'unassigned'})`],
            ),
          ]),
        ),
      ),
  })

const errorLine = (model: Model, maybeError: Option.Option<IssueError>, prefix: string, h: HtmlBuilder<Message>): Html =>
  pipe(
    maybeError,
    Option.filter(error => isSelected(model, error.id)),
    Option.match({ onNone: () => h.empty, onSome: error => h.p([], [`${prefix}${error.message}`]) }),
  )

const assignErrorLine = (model: Model, h: HtmlBuilder<Message>): Html =>
  pipe(
    model.maybeAssignError,
    Option.filter(error => isSelected(model, error.id)),
    Option.match({ onNone: () => h.empty, onSome: error => h.p([testId(h, 'assign-error')], [error.message]) }),
  )

const commentsView = (model: Model, id: number, h: HtmlBuilder<Message>): Html =>
  CommentsState.match(model.comments, {
    Loading: () => h.p([], ['loading comments']),
    Failed: ({ error }) => h.p([], [`comments error: ${error}`]),
    Loaded: ({ comments }) =>
      h.ul([], [
        ...Array.map(comments, comment => h.li([testId(h, 'comment')], [`${comment.author}: ${comment.text}`])),
        ...pipe(
          model.sending,
          Array.filter(sending => sending.id === id),
          Array.map(sending =>
            h.keyed('li')(`s${sending.seq}`, [testId(h, 'comment')], [`${sending.author}: ${sending.text} (sending…)`]),
          ),
        ),
      ]),
  })

const detailBody = (model: Model, id: number, h: HtmlBuilder<Message>): Html =>
  DetailState.match(model.detail, {
    Loading: () => h.p([], [`loading #${id}`]),
    Failed: ({ error }) => h.p([], [`detail error: ${error}`]),
    Loaded: ({ detail }) =>
      h.div([], [
        h.h2([], [`#${detail.id} ${Option.getOrElse(latestGuess(model.renaming, detail.id), () => detail.title)}`]),
        h.p([], [detail.body]),
      ]),
  })

const detailView = (model: Model, id: number, h: HtmlBuilder<Message>): ReadonlyArray<Html> => [
  detailBody(model, id, h),
  h.button([testId(h, 'retry'), h.OnClick(Message.ClickedRetry())], ['retry']),
  h.button([testId(h, 'assign'), h.OnClick(Message.ClickedAssign())], [`assign to ${model.user}`]),
  assignErrorLine(model, h),
  h.div([], [
    h.input([
      testId(h, 'title-input'),
      h.Value(model.titleInput),
      h.OnInput(value => Message.UpdatedTitleInput({ value })),
    ]),
    h.button([testId(h, 'rename'), h.OnClick(Message.ClickedRename())], ['rename']),
    errorLine(model, model.maybeRenameError, 'rename error: ', h),
  ]),
  h.button([testId(h, 'close'), h.OnClick(Message.ClickedClose())], ['close']),
  errorLine(model, model.maybeCloseError, 'close error: ', h),
  h.div([testId(h, 'comments')], [commentsView(model, id, h)]),
  h.input([
    testId(h, 'comment-input'),
    h.Value(model.commentInput),
    h.OnInput(value => Message.UpdatedCommentInput({ value })),
  ]),
  h.button([testId(h, 'post'), h.OnClick(Message.ClickedPost())], ['post']),
  errorLine(model, model.maybePostError, 'post error: ', h),
]

export const view = Submodel.defineView<Model, Message>((model, h) =>
  h.div([], [
    h.section([], [
      h.label([], [
        'user ',
        h.input([testId(h, 'user'), h.Value(model.user), h.OnInput(value => Message.UpdatedUser({ value }))]),
      ]),
      h.div([], [
        h.button([testId(h, 'filter-open'), h.OnClick(Message.ClickedFilter({ filter: 'open' }))], ['open']),
        h.button([testId(h, 'filter-closed'), h.OnClick(Message.ClickedFilter({ filter: 'closed' }))], ['closed']),
      ]),
      h.div([testId(h, 'list')], [listView(model, h)]),
    ]),
    h.section(
      [testId(h, 'detail')],
      Option.match(model.maybeSelected, {
        onNone: () => [h.p([], ['select an issue'])],
        onSome: id => detailView(model, id, h),
      }),
    ),
  ]),
)
