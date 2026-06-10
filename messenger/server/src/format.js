'use strict';

// Преобразование строк БД в публичные объекты API.
// hub подключается лениво: hub.js сам использует этот модуль.

const { users, chats, messages, reactions } = require('./db');

const hub = () => require('./hub');

function publicUser(u) {
  return {
    id: Number(u.id),
    username: u.username,
    name: u.name,
    bio: u.bio || '',
    avatar: u.avatar_file ? `/files/${u.avatar_file}` : null,
    lastSeen: Number(u.last_seen || 0),
    online: u.is_bot ? true : hub().isOnline(Number(u.id)),
    isBot: !!u.is_bot,
    role: u.role || undefined,
  };
}

function publicMessage(m) {
  if (!m) return null;
  const reacts = {};
  for (const r of reactions.forMessage(m.id)) {
    if (!reacts[r.emoji]) reacts[r.emoji] = { emoji: r.emoji, count: 0, userIds: [], names: [] };
    reacts[r.emoji].count++;
    reacts[r.emoji].userIds.push(Number(r.user_id));
    reacts[r.emoji].names.push(r.name);
  }
  let replyTo = null;
  if (m.reply_to) {
    const r = messages.byId(m.reply_to);
    if (r) {
      replyTo = {
        id: Number(r.id),
        senderName: r.sender_name,
        kind: r.kind,
        text: r.deleted ? '' : r.text,
        deleted: !!r.deleted,
      };
    }
  }
  return {
    id: Number(m.id),
    chatId: Number(m.chat_id),
    senderId: Number(m.sender_id),
    senderName: m.sender_name,
    senderUsername: m.sender_username,
    senderAvatar: m.sender_avatar ? `/files/${m.sender_avatar}` : null,
    kind: m.kind || 'text',
    text: m.deleted ? '' : m.text,
    file: m.file_id && !m.deleted ? {
      id: Number(m.file_id),
      name: m.file_name,
      mime: m.file_mime,
      size: Number(m.file_size),
      url: `/files/${m.file_id}`,
    } : null,
    replyTo,
    forwardFrom: m.forward_from || null,
    reactions: Object.values(reacts),
    createdAt: Number(m.created_at),
    editedAt: m.edited_at ? Number(m.edited_at) : null,
    deleted: !!m.deleted,
  };
}

function chatView(chat, forUserId) {
  const members = chats.members(chat.id).map(publicUser);
  const membership = chats.member(chat.id, forUserId);
  let title = chat.title;
  let peer = null;
  if (chat.type === 'direct') {
    peer = members.find((m) => m.id !== forUserId) || members[0];
    title = peer ? peer.name : 'Удалённый аккаунт';
  }
  const last = messages.last(chat.id);
  const pinnedId = chat.pinned_message_id ? Number(chat.pinned_message_id) : null;
  return {
    id: Number(chat.id),
    type: chat.type,
    title,
    description: chat.description || '',
    avatar: chat.type === 'direct'
      ? (peer ? peer.avatar : null)
      : (chat.avatar_file ? `/files/${chat.avatar_file}` : null),
    peer,
    members,
    myRole: (membership && membership.role) || 'member',
    muted: !!(membership && membership.muted),
    unread: Number(chat.unread || 0),
    lastMessage: last ? publicMessage(last) : null,
    pinnedMessage: pinnedId ? publicMessage(messages.byId(pinnedId)) : null,
    readByOthersUpTo: chats.readByOthersUpTo(chat.id, forUserId),
  };
}

module.exports = { publicUser, publicMessage, chatView };
