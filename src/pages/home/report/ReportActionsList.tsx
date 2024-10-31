import type {ListRenderItemInfo} from '@react-native/virtualized-lists/Lists/VirtualizedList';
import {useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
// eslint-disable-next-line lodash/import-scope
import type {DebouncedFunc} from 'lodash';
import React, {memo, useCallback, useEffect, useMemo, useRef} from 'react';
import {InteractionManager, View} from 'react-native';
import type {LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, StyleProp, ViewStyle} from 'react-native';
import {useOnyx} from 'react-native-onyx';
import type {OnyxEntry} from 'react-native-onyx';
import InvertedFlatList from '@components/InvertedFlatList';
import {usePersonalDetails} from '@components/OnyxProvider';
import useCurrentUserPersonalDetails from '@hooks/useCurrentUserPersonalDetails';
import useLocalize from '@hooks/useLocalize';
import useNetwork from '@hooks/useNetwork';
import useReportScrollManager from '@hooks/useReportScrollManager';
import useResponsiveLayout from '@hooks/useResponsiveLayout';
import useThemeStyles from '@hooks/useThemeStyles';
import useWindowDimensions from '@hooks/useWindowDimensions';
import Navigation from '@libs/Navigation/Navigation';
import * as ReportActionsUtils from '@libs/ReportActionsUtils';
import * as ReportUtils from '@libs/ReportUtils';
import type {AuthScreensParamList} from '@navigation/types';
import variables from '@styles/variables';
import * as Report from '@userActions/Report';
import CONST from '@src/CONST';
import ONYXKEYS from '@src/ONYXKEYS';
import ROUTES from '@src/ROUTES';
import type SCREENS from '@src/SCREENS';
import type * as OnyxTypes from '@src/types/onyx';
import getInitialNumToRender from './getInitialNumReportActionsToRender';
import ListBoundaryLoader from './ListBoundaryLoader';
import ReportActionsListItemRenderer from './ReportActionsListItemRenderer';

type LoadNewerChats = DebouncedFunc<(params: {distanceFromStart: number}) => void>;

type ReportActionsListProps = {
    /** The report currently being looked at */
    report: OnyxTypes.Report;

    /** The transaction thread report associated with the current report, if any */
    transactionThreadReport: OnyxEntry<OnyxTypes.Report>;

    /** Array of report actions for the current report */
    reportActions: OnyxTypes.ReportAction[];

    /** The report's parentReportAction */
    parentReportAction: OnyxEntry<OnyxTypes.ReportAction>;

    /** The transaction thread report's parentReportAction */
    parentReportActionForTransactionThread: OnyxEntry<OnyxTypes.ReportAction>;

    /** Sorted actions prepared for display */
    sortedVisibleReportActions: OnyxTypes.ReportAction[];

    /** The ID of the most recent IOU report action connected with the shown report */
    mostRecentIOUReportActionID?: string | null;

    /** The report metadata loading states */
    isLoadingInitialReportActions?: boolean;

    /** Are we loading more report actions? */
    isLoadingOlderReportActions?: boolean;

    /** Was there an error when loading older report actions? */
    hasLoadingOlderReportActionsError?: boolean;

    /** Are we loading newer report actions? */
    isLoadingNewerReportActions?: boolean;

    /** Was there an error when loading newer report actions? */
    hasLoadingNewerReportActionsError?: boolean;

    /** Callback executed on list layout */
    onLayout: (event: LayoutChangeEvent) => void;

    /** Callback executed on scroll */
    onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;

    /** Function to load more chats */
    loadOlderChats: (force?: boolean) => void;

    /** Function to load newer chats */
    loadNewerChats: (force?: boolean) => void;

    /** Whether the composer is in full size */
    isComposerFullSize?: boolean;

    /** ID of the list */
    listID: number;

    /** Callback executed on content size change */
    onContentSizeChange: (w: number, h: number) => void;

    /** Should enable auto scroll to top threshold */
    shouldEnableAutoScrollToTopThreshold?: boolean;

    unreadMarkerReportActionID?: string | null;
};

// In the component we are subscribing to the arrival of new actions.
// As there is the possibility that there are multiple instances of a ReportScreen
// for the same report, we only ever want one subscription to be active, as
// the subscriptions could otherwise be conflicting.
const newActionUnsubscribeMap: Record<string, () => void> = {};

/**
 * Create a unique key for each action in the FlatList.
 * We use the reportActionID that is a string representation of a random 64-bit int, which should be
 * random enough to avoid collisions
 */
function keyExtractor(item: OnyxTypes.ReportAction): string {
    return item.reportActionID;
}

const onScrollToIndexFailed = () => {};

function ReportActionsList({
    report,
    transactionThreadReport,
    reportActions = [],
    parentReportAction,
    isLoadingInitialReportActions = false,
    isLoadingOlderReportActions = false,
    hasLoadingOlderReportActionsError = false,
    isLoadingNewerReportActions = false,
    hasLoadingNewerReportActionsError = false,
    sortedVisibleReportActions,
    onScroll,
    mostRecentIOUReportActionID = '',
    loadNewerChats,
    loadOlderChats,
    onLayout,
    isComposerFullSize,
    listID,
    onContentSizeChange,
    shouldEnableAutoScrollToTopThreshold,
    parentReportActionForTransactionThread,
    unreadMarkerReportActionID,
}: ReportActionsListProps) {
    const currentUserPersonalDetails = useCurrentUserPersonalDetails();
    const personalDetailsList = usePersonalDetails() || CONST.EMPTY_OBJECT;
    const styles = useThemeStyles();
    const {translate} = useLocalize();
    const {windowHeight} = useWindowDimensions();
    const {isInNarrowPaneModal, shouldUseNarrowLayout} = useResponsiveLayout();

    const {isOffline} = useNetwork();
    const route = useRoute<RouteProp<AuthScreensParamList, typeof SCREENS.REPORT>>();
    const reportScrollManager = useReportScrollManager();

    const [reportNameValuePairs] = useOnyx(`${ONYXKEYS.COLLECTION.REPORT_NAME_VALUE_PAIRS}${report?.reportID ?? -1}`);

    const hasHeaderRendered = useRef(false);
    const hasFooterRendered = useRef(false);
    const linkedReportActionID = route?.params?.reportActionID ?? '-1';
    const lastAction = sortedVisibleReportActions.at(0);

    const lastVisibleActionCreated =
        (transactionThreadReport?.lastVisibleActionCreated ?? '') > (report.lastVisibleActionCreated ?? '')
            ? transactionThreadReport?.lastVisibleActionCreated
            : report.lastVisibleActionCreated;
    const hasNewestReportAction = lastAction?.created === lastVisibleActionCreated;
    const hasNewestReportActionRef = useRef(hasNewestReportAction);
    // eslint-disable-next-line react-compiler/react-compiler
    hasNewestReportActionRef.current = hasNewestReportAction;

    useEffect(() => {
        if (linkedReportActionID) {
            return;
        }
        InteractionManager.runAfterInteractions(() => {
            reportScrollManager.scrollToBottom();
        });
        // eslint-disable-next-line react-compiler/react-compiler, react-hooks/exhaustive-deps
    }, []);

    const scrollToBottomForCurrentUserAction = useCallback(
        (isFromCurrentUser: boolean) => {
            // If a new comment is added and it's from the current user scroll to the bottom otherwise leave the user positioned where
            // they are now in the list.
            if (!isFromCurrentUser) {
                return;
            }
            if (!hasNewestReportActionRef.current) {
                if (isInNarrowPaneModal) {
                    return;
                }
                Navigation.navigate(ROUTES.REPORT_WITH_ID.getRoute(report.reportID));
                return;
            }
            InteractionManager.runAfterInteractions(() => reportScrollManager.scrollToBottom());
        },
        [isInNarrowPaneModal, reportScrollManager, report.reportID],
    );
    useEffect(() => {
        // Why are we doing this, when in the cleanup of the useEffect we are already calling the unsubscribe function?
        // Answer: On web, when navigating to another report screen, the previous report screen doesn't get unmounted,
        //         meaning that the cleanup might not get called. When we then open a report we had open already previosuly, a new
        //         ReportScreen will get created. Thus, we have to cancel the earlier subscription of the previous screen,
        //         because the two subscriptions could conflict!
        //         In case we return to the previous screen (e.g. by web back navigation) the useEffect for that screen would
        //         fire again, as the focus has changed and will set up the subscription correctly again.
        const previousSubUnsubscribe = newActionUnsubscribeMap[report.reportID];
        if (previousSubUnsubscribe) {
            previousSubUnsubscribe();
        }

        // This callback is triggered when a new action arrives via Pusher and the event is emitted from Report.js. This allows us to maintain
        // a single source of truth for the "new action" event instead of trying to derive that a new action has appeared from looking at props.
        const unsubscribe = Report.subscribeToNewActionEvent(report.reportID, scrollToBottomForCurrentUserAction);

        const cleanup = () => {
            if (!unsubscribe) {
                return;
            }
            unsubscribe();
        };

        newActionUnsubscribeMap[report.reportID] = cleanup;

        return cleanup;

        // eslint-disable-next-line react-compiler/react-compiler, react-hooks/exhaustive-deps
    }, [report.reportID]);

    /**
     * Calculates the ideal number of report actions to render in the first render, based on the screen height and on
     * the height of the smallest report action possible.
     */
    const initialNumToRender = useMemo((): number | undefined => {
        const minimumReportActionHeight = styles.chatItem.paddingTop + styles.chatItem.paddingBottom + variables.fontSizeNormalHeight;
        const availableHeight = windowHeight - (CONST.CHAT_FOOTER_MIN_HEIGHT + variables.contentHeaderHeight);
        const numToRender = Math.ceil(availableHeight / minimumReportActionHeight);
        if (linkedReportActionID) {
            return getInitialNumToRender(numToRender);
        }
        return numToRender || undefined;
    }, [styles.chatItem.paddingBottom, styles.chatItem.paddingTop, windowHeight, linkedReportActionID]);

    /**
     * Thread's divider line should hide when the first chat in the thread is marked as unread.
     * This is so that it will not be conflicting with header's separator line.
     */
    const shouldHideThreadDividerLine = useMemo(
        (): boolean => ReportActionsUtils.getFirstVisibleReportActionID(reportActions, isOffline) === unreadMarkerReportActionID,
        [reportActions, isOffline, unreadMarkerReportActionID],
    );

    const firstVisibleReportActionID = useMemo(() => ReportActionsUtils.getFirstVisibleReportActionID(reportActions, isOffline), [reportActions, isOffline]);

    const shouldUseThreadDividerLine = useMemo(() => {
        const topReport = sortedVisibleReportActions.length > 0 ? sortedVisibleReportActions.at(sortedVisibleReportActions.length - 1) : null;

        if (topReport && topReport.actionName !== CONST.REPORT.ACTIONS.TYPE.CREATED) {
            return false;
        }

        if (ReportActionsUtils.isTransactionThread(parentReportAction)) {
            return !ReportActionsUtils.isDeletedParentAction(parentReportAction) && !ReportActionsUtils.isReversedTransaction(parentReportAction);
        }

        if (ReportUtils.isTaskReport(report)) {
            return !ReportUtils.isCanceledTaskReport(report, parentReportAction);
        }

        return ReportUtils.isExpenseReport(report) || ReportUtils.isIOUReport(report) || ReportUtils.isInvoiceReport(report);
    }, [parentReportAction, report, sortedVisibleReportActions]);

    const renderItem = useCallback(
        ({item: reportAction, index}: ListRenderItemInfo<OnyxTypes.ReportAction>) => (
            <ReportActionsListItemRenderer
                reportAction={reportAction}
                reportActions={reportActions}
                parentReportAction={parentReportAction}
                parentReportActionForTransactionThread={parentReportActionForTransactionThread}
                index={index}
                report={report}
                transactionThreadReport={transactionThreadReport}
                linkedReportActionID={linkedReportActionID}
                displayAsGroup={
                    !ReportActionsUtils.isConsecutiveChronosAutomaticTimerAction(sortedVisibleReportActions, index, ReportUtils.chatIncludesChronosWithID(reportAction?.reportID)) &&
                    ReportActionsUtils.isConsecutiveActionMadeByPreviousActor(sortedVisibleReportActions, index)
                }
                mostRecentIOUReportActionID={mostRecentIOUReportActionID}
                shouldHideThreadDividerLine={shouldHideThreadDividerLine}
                shouldDisplayNewMarker={reportAction.reportActionID === unreadMarkerReportActionID}
                shouldDisplayReplyDivider={sortedVisibleReportActions.length > 1}
                isFirstVisibleReportAction={firstVisibleReportActionID === reportAction.reportActionID}
                shouldUseThreadDividerLine={shouldUseThreadDividerLine}
            />
        ),
        [
            report,
            linkedReportActionID,
            sortedVisibleReportActions,
            mostRecentIOUReportActionID,
            shouldHideThreadDividerLine,
            parentReportAction,
            reportActions,
            transactionThreadReport,
            parentReportActionForTransactionThread,
            shouldUseThreadDividerLine,
            firstVisibleReportActionID,
            unreadMarkerReportActionID,
        ],
    );

    // Native mobile does not render updates flatlist the changes even though component did update called.
    // To notify there something changes we can use extraData prop to flatlist
    const extraData = useMemo(
        () => [shouldUseNarrowLayout ? unreadMarkerReportActionID : undefined, ReportUtils.isArchivedRoom(report, reportNameValuePairs)],
        [unreadMarkerReportActionID, shouldUseNarrowLayout, report, reportNameValuePairs],
    );
    const hideComposer = !ReportUtils.canUserPerformWriteAction(report);
    const shouldShowReportRecipientLocalTime = ReportUtils.canShowReportRecipientLocalTime(personalDetailsList, report, currentUserPersonalDetails.accountID) && !isComposerFullSize;
    // eslint-disable-next-line react-compiler/react-compiler
    const canShowHeader = isOffline || hasHeaderRendered.current;

    const contentContainerStyle: StyleProp<ViewStyle> = useMemo(
        () => [styles.chatContentScrollView, isLoadingNewerReportActions && canShowHeader ? styles.chatContentScrollViewWithHeaderLoader : {}],
        [isLoadingNewerReportActions, styles.chatContentScrollView, styles.chatContentScrollViewWithHeaderLoader, canShowHeader],
    );

    const lastReportAction: OnyxTypes.ReportAction | undefined = useMemo(() => reportActions.at(-1) ?? undefined, [reportActions]);

    const retryLoadOlderChatsError = useCallback(() => {
        loadOlderChats(true);
    }, [loadOlderChats]);

    // eslint-disable-next-line react-compiler/react-compiler
    const listFooterComponent = useMemo(() => {
        // Skip this hook on the first render (when online), as we are not sure if more actions are going to be loaded,
        // Therefore showing the skeleton on footer might be misleading.
        // When offline, there should be no second render, so we should show the skeleton if the corresponding loading prop is present.
        // In case of an error we want to display the footer no matter what.
        if (!isOffline && !hasFooterRendered.current && !hasLoadingOlderReportActionsError) {
            hasFooterRendered.current = true;
            return null;
        }

        return (
            <ListBoundaryLoader
                type={CONST.LIST_COMPONENTS.FOOTER}
                isLoadingOlderReportActions={isLoadingOlderReportActions}
                isLoadingInitialReportActions={isLoadingInitialReportActions}
                lastReportActionName={lastReportAction?.actionName}
                hasError={hasLoadingOlderReportActionsError}
                onRetry={retryLoadOlderChatsError}
            />
        );
    }, [isLoadingInitialReportActions, isLoadingOlderReportActions, lastReportAction?.actionName, isOffline, hasLoadingOlderReportActionsError, retryLoadOlderChatsError]);

    const onLayoutInner = useCallback(
        (event: LayoutChangeEvent) => {
            onLayout(event);
        },
        [onLayout],
    );
    const onContentSizeChangeInner = useCallback(
        (w: number, h: number) => {
            onContentSizeChange(w, h);
        },
        [onContentSizeChange],
    );

    // eslint-disable-next-line react-compiler/react-compiler
    const retryLoadNewerChatsError = useCallback(() => {
        loadNewerChats(true);
    }, [loadNewerChats]);

    const listHeaderComponent = useMemo(() => {
        // In case of an error we want to display the header no matter what.
        if (!canShowHeader && !hasLoadingNewerReportActionsError) {
            // eslint-disable-next-line react-compiler/react-compiler
            hasHeaderRendered.current = true;
            return null;
        }

        return (
            <ListBoundaryLoader
                type={CONST.LIST_COMPONENTS.HEADER}
                isLoadingNewerReportActions={isLoadingNewerReportActions}
                hasError={hasLoadingNewerReportActionsError}
                onRetry={retryLoadNewerChatsError}
            />
        );
    }, [isLoadingNewerReportActions, canShowHeader, hasLoadingNewerReportActionsError, retryLoadNewerChatsError]);

    const onStartReached = useCallback(() => {
        InteractionManager.runAfterInteractions(() => requestAnimationFrame(() => loadNewerChats(false)));
    }, [loadNewerChats]);

    const onEndReached = useCallback(() => {
        loadOlderChats(false);
    }, [loadOlderChats]);

    return (
        <View style={[styles.flex1, !shouldShowReportRecipientLocalTime && !hideComposer ? styles.pb4 : {}]}>
            <InvertedFlatList
                accessibilityLabel={translate('sidebarScreen.listOfChatMessages')}
                ref={reportScrollManager.ref}
                testID="report-actions-list"
                style={styles.overscrollBehaviorContain}
                data={sortedVisibleReportActions}
                renderItem={renderItem}
                contentContainerStyle={contentContainerStyle}
                keyExtractor={keyExtractor}
                initialNumToRender={initialNumToRender}
                onEndReached={onEndReached}
                onEndReachedThreshold={0.75}
                onStartReached={onStartReached}
                onStartReachedThreshold={0.75}
                ListFooterComponent={listFooterComponent}
                ListHeaderComponent={listHeaderComponent}
                keyboardShouldPersistTaps="handled"
                onLayout={onLayoutInner}
                onContentSizeChange={onContentSizeChangeInner}
                onScroll={onScroll}
                onScrollToIndexFailed={onScrollToIndexFailed}
                extraData={extraData}
                key={listID}
                shouldEnableAutoScrollToTopThreshold={shouldEnableAutoScrollToTopThreshold}
            />
        </View>
    );
}

ReportActionsList.displayName = 'ReportActionsList';

export default memo(ReportActionsList);

export type {LoadNewerChats, ReportActionsListProps};
