import { RtcWhiteboard, Constants, RtsService } from '@pano.video/whiteboard';
import store from '../store';
import { Message } from 'element-ui';

const rtsService = RtsService.getInstance();
const rtcWhiteboard = new RtcWhiteboard();
window.rtsService = rtsService;
window.rtcWhiteboard = rtcWhiteboard;

/**
 * 初始化pano rts相关逻辑，pano rts包括 Whiteboard, Annotation, RtcMessage, RemoteControl 等
 */
export default function initPanoRtc() {
  /**
   * 如果会议还没有结束，将始终尝试重连rts 服务
   */
  const rejoinRtms = () => {
    if (
      store.getters.meetingStatus === 'connected' ||
      store.getters.meetingStatus === 'reconnecting'
    ) {
      console.log(
        'rejoinRtms, meetingStore.meetingStatus',
        store.getters.meetingStatus
      );
      rtcWhiteboard.joinChannel(
        {
          appId: store.getters.appId,
          token: store.getters.panoToken,
          channelId: store.getters.channelId,
          name: store.getters.userMe.userName,
          userId: store.getters.userMe.userId
        },
        () => {
          console.log('rejoinRtms success');
          Message.success('PanoRts 服务重连成功');
        },
        () => {
          console.error('rejoinRtms failed');
          rejoinRtms();
        }
      );
    }
  };

  rtsService.on(RtsService.Events.failover, data => {
    // data:  { state: 'Reconnecting' | 'Success' | 'Failed' }
    if (data.state === 'Reconnecting') {
      Message.info('PanoRts 服务连接已断开，正在重连...');
    } else if (data.state === 'Success') {
      console.log('rejoinRtms success');
      Message.success('PanoRts 服务重连成功');
    } else if (data.state === 'Failed') {
      rejoinRtms();
    }
  });

  rtcWhiteboard.on(RtcWhiteboard.Events.readyStateChanged, payload => {
    console.log('whiteboard ready state changed,', payload);
    store.commit('setWhiteboardAvailable', payload.ready);
  });

  rtcWhiteboard.on(RtcWhiteboard.Events.userRoleTypeChanged, role => {
    if (role !== Constants.WBRoleType.Attendee) {
      // 仅admin角色可以通过键盘操作课件
      rtcWhiteboard.enableCoursewareInteraction();
    } else {
      rtcWhiteboard.disableCoursewareInteraction();
    }
  });

  rtcWhiteboard.on(RtcWhiteboard.Events.messageReceived, payload => {
    console.log('got whiteboard message:', payload);
    const msg = payload.message;
    if (msg.wbHostId) {
      if (
        msg.wbHostId.toString() !== store.getters.userMe.userId &&
        store.getters.getUserById(msg.wbHostId.toString())
      ) {
        Message.info(
          `${
            store.getters.getUserById(msg.wbHostId.toString())?.userName
          } 正在演示`
        );
      }
      store.commit('setWbHost', msg.wbHostId.toString());
    }
  });

  // 其他用户初次打开白板，本端收到事件直接打开白板
  rtcWhiteboard.on(RtcWhiteboard.Events.openStateChanged, () => {
    if (!store.getters.isRemoteControling) {
      // 远程控制时不打开白板
      store.commit('setWhiteboardOpenState', true);
    }
  });

  // 如果关闭白板时有新收到的绘制消息提示白板内容有更新
  rtcWhiteboard.on(RtcWhiteboard.Events.newShapeReceived, () => {
    if (!store.getters.isWhiteboardOpen) {
      store.commit('setWhiteboardUpdatedState', true);
    }
  });

  // 视频标注开始
  rtsService.on(RtsService.Events.videoAnnotationStart, userId => {
    console.log('videoAnnotationStart', userId);
    const user = store.getters.getUserById(`${userId}`);
    if (!user) {
      return;
    }
    store.commit('updateUser', { userId, videoAnnotationOpen: true });
    if (!store.getters.isRemoteControling) {
      // 远程控制时不可切换主视图
      store.commit('setWhiteboardOpenState', false);
      store.dispatch('trySelectMainView', { user });
    }
  });

  // 视频标注结束
  rtsService.on(RtsService.Events.videoAnnotationStop, userId => {
    console.log('videoAnnotationStop', userId);
    store.commit('updateUser', { userId, videoAnnotationOpen: false });
  });

  // 桌面共享标注开始
  rtsService.on(RtsService.Events.shareAnnotationStart, userId => {
    const user = store.getters.getUserById(`${userId}`);
    if (!user) {
      return;
    }
    console.log('shareAnnotationStart', user.userName);
    store.commit('updateUser', { userId, shareAnnotationOpen: true });
    if (!store.getters.isRemoteControling) {
      // 远程控制时不可切换主视图
      store.commit('setWhiteboardOpenState', false);
      store.dispatch('trySelectMainView', { user });
    }
  });

  // 桌面共享标注结束
  rtsService.on(RtsService.Events.shareAnnotationStop, userId => {
    console.log('shareAnnotationStop', userId);
    store.commit('updateUser', { userId, shareAnnotationOpen: false });
  });
}

/**
 * 申请 admin 角色（演示权限）
 */
export function applyForWbAdmin() {
  return new Promise((resolve, reject) => {
    if (window.rtcWhiteboard.isAdmin) {
      resolve();
      return;
    }
    window.rtcWhiteboard.setRoleType(Constants.WBRoleType.Admin);
    let reqForAdminTimeout;
    const onRoleChanged = role => {
      clearTimeout(reqForAdminTimeout);
      if (role === Constants.WBRoleType.Admin) {
        window.rtcWhiteboard.broadcastMessage({
          wbHostId: store.getters.userMe.userId
        });
        resolve();
      } else {
        reject();
      }
      window.rtcWhiteboard.off(
        RtcWhiteboard.Events.userRoleTypeChanged,
        onRoleChanged
      );
    };
    // 2s 内获取不到权限提示失败
    reqForAdminTimeout = setTimeout(() => {
      window.rtcWhiteboard.off(
        RtcWhiteboard.Events.userRoleTypeChanged,
        onRoleChanged
      );
      reject();
      console.error('获取演示权限失败，请重试.');
    }, 2000);
    window.rtcWhiteboard.on(
      RtcWhiteboard.Events.userRoleTypeChanged,
      onRoleChanged
    );
  });
}