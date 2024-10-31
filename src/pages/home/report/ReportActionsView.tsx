import type {RouteProp} from '@react-navigation/native';
import {useIsFocused, useRoute} from '@react-navigation/native';
import lodashIsEqual from 'lodash/isEqual';
import React, {useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react';
import {DeviceEventEmitter, InteractionManager} from 'react-native';
import type {NativeScrollEvent, NativeSyntheticEvent} from 'react-native';
import type {OnyxEntry} from 'react-native-onyx';
import {useOnyx} from 'react-native-onyx';
import {AUTOSCROLL_TO_TOP_THRESHOLD} from '@components/InvertedFlatList/BaseInvertedFlatList';
import useCopySelectionHelper from '@hooks/useCopySelectionHelper';
import useInitialValue from '@hooks/useInitialValue';
import useIsVisible from '@hooks/useIsVisible';
import useNetwork from '@hooks/useNetwork';
import usePrevious from '@hooks/usePrevious';
import useReportScrollManager from '@hooks/useReportScrollManager';
import useResponsiveLayout from '@hooks/useResponsiveLayout';
import DateUtils from '@libs/DateUtils';
import getIsReportFullyVisible from '@libs/getIsReportFullyVisible';
import Navigation from '@libs/Navigation/Navigation';
import type {AuthScreensParamList} from '@libs/Navigation/types';
import * as NumberUtils from '@libs/NumberUtils';
import {generateNewRandomInt} from '@libs/NumberUtils';
import Performance from '@libs/Performance';
import * as ReportActionsUtils from '@libs/ReportActionsUtils';
import * as ReportUtils from '@libs/ReportUtils';
import {isUserCreatedPolicyRoom} from '@libs/ReportUtils';
import {didUserLogInDuringSession} from '@libs/SessionUtils';
import shouldFetchReport from '@libs/shouldFetchReport';
import {ReactionListContext} from '@pages/home/ReportScreenContext';
import * as Report from '@userActions/Report';
import Timing from '@userActions/Timing';
import CONST from '@src/CONST';
import ONYXKEYS from '@src/ONYXKEYS';
import ROUTES from '@src/ROUTES';
import type SCREENS from '@src/SCREENS';
import type * as OnyxTypes from '@src/types/onyx';
import {isEmptyObject} from '@src/types/utils/EmptyObject';
import FloatingMessageCounter from './FloatingMessageCounter';
import getInitialPaginationSize from './getInitialPaginationSize';
import PopoverReactionList from './ReactionList/PopoverReactionList';
import ReportActionsList from './ReportActionsList';
import UserTypingEventListener from './UserTypingEventListener';

const MSG_VISIBLE_THRESHOLD = 250;
const VERTICAL_OFFSET_THRESHOLD = 200;

function isMessageUnread(message: OnyxTypes.ReportAction, lastReadTime?: string): boolean {
    if (!lastReadTime) {
        return !ReportActionsUtils.isCreatedAction(message);
    }

    return !!(message && lastReadTime && message.created && lastReadTime < message.created);
}

// Seems that there is an architecture issue that prevents us from using the reportID with useRef
// the useRef value gets reset when the reportID changes, so we use a global variable to keep track
let prevReportID: string | null = null;

type ReportActionsViewProps = {
    /** The report currently being looked at */
    report: OnyxTypes.Report;

    /** Array of report actions for this report */
    reportActions?: OnyxTypes.ReportAction[];

    /** The report's parentReportAction */
    parentReportAction: OnyxEntry<OnyxTypes.ReportAction>;

    /** The report metadata loading states */
    isLoadingInitialReportActions?: boolean;

    /** The report actions are loading more data */
    isLoadingOlderReportActions?: boolean;

    /** There an error when loading older report actions */
    hasLoadingOlderReportActionsError?: boolean;

    /** The report actions are loading newer data */
    isLoadingNewerReportActions?: boolean;

    /** There an error when loading newer report actions */
    hasLoadingNewerReportActionsError?: boolean;

    /** The reportID of the transaction thread report associated with this current report, if any */
    // eslint-disable-next-line react/no-unused-prop-types
    transactionThreadReportID?: string | null;

    /** If the report has newer actions to load */
    hasNewerActions: boolean;

    /** If the report has older actions to load */
    hasOlderActions: boolean;
};

let listOldID = Math.round(Math.random() * 100);

function ReportActionsView({
    report,
    parentReportAction,
    reportActions: allReportActions = [],
    isLoadingInitialReportActions = false,
    isLoadingOlderReportActions = false,
    hasLoadingOlderReportActionsError = false,
    isLoadingNewerReportActions = false,
    hasLoadingNewerReportActionsError = false,
    transactionThreadReportID,
    hasNewerActions,
    hasOlderActions,
}: ReportActionsViewProps) {
    useCopySelectionHelper();
    const reactionListRef = useContext(ReactionListContext);
    const route = useRoute<RouteProp<AuthScreensParamList, typeof SCREENS.REPORT>>();
    const [session] = useOnyx(ONYXKEYS.SESSION);
    const [transactionThreadReportActions] = useOnyx(`${ONYXKEYS.COLLECTION.REPORT_ACTIONS}${transactionThreadReportID ?? -1}`, {
        selector: (reportActions: OnyxEntry<OnyxTypes.ReportActions>) => ReportActionsUtils.getSortedReportActionsForDisplay(reportActions, true),
    });
    const [transactionThreadReport] = useOnyx(`${ONYXKEYS.COLLECTION.REPORT}${transactionThreadReportID ?? -1}`);
    const accountID = session?.accountID;
    const userActiveSince = useRef<string>(DateUtils.getDBTime());
    const lastMessageTime = useRef<string | null>(null);
    const scrollingVerticalOffset = useRef(0);
    const readActionSkipped = useRef(false);
    const prevTransactionThreadReport = usePrevious(transactionThreadReport);
    const reportActionID = route?.params?.reportActionID;
    const prevReportActionID = usePrevious(reportActionID);
    const didLayout = useRef(false);
    const didLoadOlderChats = useRef(false);
    const didLoadNewerChats = useRef(false);
    const {isOffline} = useNetwork();
    const isVisible = useIsVisible();
    const reportScrollManager = useReportScrollManager();

    // triggerListID is used when navigating to a chat with messages loaded from LHN. Typically, these include thread actions, task actions, etc. Since these messages aren't the latest,we don't maintain their position and instead trigger a recalculation of their positioning in the list.
    // we don't set currentReportActionID on initial render as linkedID as it should trigger visibleReportActions after linked message was positioned
    const [currentReportActionID, setCurrentReportActionID] = useState('');
    const isFirstLinkedActionRender = useRef(true);

    const network = useNetwork();
    const {shouldUseNarrowLayout} = useResponsiveLayout();
    const contentListHeight = useRef(0);
    const isFocused = useIsFocused();
    const prevAuthTokenType = usePrevious(session?.authTokenType);
    const [isNavigatingToLinkedMessage, setNavigatingToLinkedMessage] = useState(!!reportActionID);
    const prevShouldUseNarrowLayoutRef = useRef(shouldUseNarrowLayout);
    const reportID = report.reportID;
    const isReportFullyVisible = useMemo((): boolean => getIsReportFullyVisible(isFocused), [isFocused]);
    const openReportIfNecessary = () => {
        if (!shouldFetchReport(report)) {
            return;
        }

        Report.openReport(reportID, reportActionID);
    };

    useEffect(() => {
        // When we linked to message - we do not need to wait for initial actions - they already exists
        if (!reportActionID || !isOffline) {
            return;
        }
        Report.updateLoadingInitialReportAction(report.reportID);
    }, [isOffline, report.reportID, reportActionID]);

    // Change the list ID only for comment linking to get the positioning right
    const listID = useMemo(() => {
        if (!reportActionID && !prevReportActionID) {
            // Keep the old list ID since we're not in the Comment Linking flow
            return listOldID;
        }
        isFirstLinkedActionRender.current = true;
        const newID = generateNewRandomInt(listOldID, 1, Number.MAX_SAFE_INTEGER);
        // eslint-disable-next-line react-compiler/react-compiler
        listOldID = newID;

        setCurrentReportActionID('');

        return newID;
        // eslint-disable-next-line react-compiler/react-compiler, react-hooks/exhaustive-deps
    }, [route, reportActionID]);

    // When we are offline before opening an IOU/Expense report,
    // the total of the report and sometimes the expense aren't displayed because these actions aren't returned until `OpenReport` API is complete.
    // We generate a fake created action here if it doesn't exist to display the total whenever possible because the total just depends on report data
    // and we also generate an expense action if the number of expenses in allReportActions is less than the total number of expenses
    // to display at least one expense action to match the total data.
    const reportActionsToDisplay = useMemo(() => {
        if (!ReportUtils.isMoneyRequestReport(report) || !allReportActions.length) {
            return allReportActions;
        }

        const actions = [...allReportActions];
        const lastAction = allReportActions.at(-1);

        if (lastAction && !ReportActionsUtils.isCreatedAction(lastAction)) {
            const optimisticCreatedAction = ReportUtils.buildOptimisticCreatedReportAction(String(report?.ownerAccountID), DateUtils.subtractMillisecondsFromDateTime(lastAction.created, 1));
            optimisticCreatedAction.pendingAction = null;
            actions.push(optimisticCreatedAction);
        }

        const reportPreviewAction = ReportActionsUtils.getReportPreviewAction(report.chatReportID ?? '', report.reportID);
        const moneyRequestActions = allReportActions.filter((action) => {
            const originalMessage = ReportActionsUtils.isMoneyRequestAction(action) ? ReportActionsUtils.getOriginalMessage(action) : undefined;
            return (
                ReportActionsUtils.isMoneyRequestAction(action) &&
                originalMessage &&
                (originalMessage?.type === CONST.IOU.REPORT_ACTION_TYPE.CREATE ||
                    !!(originalMessage?.type === CONST.IOU.REPORT_ACTION_TYPE.PAY && originalMessage?.IOUDetails) ||
                    originalMessage?.type === CONST.IOU.REPORT_ACTION_TYPE.TRACK)
            );
        });

        if (report.total && moneyRequestActions.length < (reportPreviewAction?.childMoneyRequestCount ?? 0) && isEmptyObject(transactionThreadReport)) {
            const optimisticIOUAction = ReportUtils.buildOptimisticIOUReportAction(
                CONST.IOU.REPORT_ACTION_TYPE.CREATE,
                0,
                CONST.CURRENCY.USD,
                '',
                [],
                NumberUtils.rand64(),
                undefined,
                report.reportID,
                false,
                false,
                false,
                DateUtils.subtractMillisecondsFromDateTime(actions.at(-1)?.created ?? '', 1),
            ) as OnyxTypes.ReportAction;
            moneyRequestActions.push(optimisticIOUAction);
            actions.splice(actions.length - 1, 0, optimisticIOUAction);
        }

        // Update pending action of created action if we have some requests that are pending
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const createdAction = actions.pop()!;
        if (moneyRequestActions.filter((action) => !!action.pendingAction).length > 0) {
            createdAction.pendingAction = CONST.RED_BRICK_ROAD_PENDING_ACTION.UPDATE;
        }

        return [...actions, createdAction];
    }, [allReportActions, report, transactionThreadReport]);

    // Get a sorted array of reportActions for both the current report and the transaction thread report associated with this report (if there is one)
    // so that we display transaction-level and report-level report actions in order in the one-transaction view
    const combinedReportActions = useMemo(
        () => ReportActionsUtils.getCombinedReportActions(reportActionsToDisplay, transactionThreadReportID ?? null, transactionThreadReportActions ?? []),
        [reportActionsToDisplay, transactionThreadReportActions, transactionThreadReportID],
    );

    const parentReportActionForTransactionThread = useMemo(
        () =>
            isEmptyObject(transactionThreadReportActions)
                ? undefined
                : (allReportActions.find((action) => action.reportActionID === transactionThreadReport?.parentReportActionID) as OnyxEntry<OnyxTypes.ReportAction>),
        [allReportActions, transactionThreadReportActions, transactionThreadReport?.parentReportActionID],
    );

    const indexOfLinkedAction = useMemo(() => {
        if (!reportActionID) {
            return -1;
        }
        return combinedReportActions.findIndex((obj) => String(obj.reportActionID) === String(isFirstLinkedActionRender.current ? reportActionID : currentReportActionID));
    }, [combinedReportActions, currentReportActionID, reportActionID]);

    const reportActions = useMemo(() => {
        if (!reportActionID) {
            return combinedReportActions;
        }
        if (indexOfLinkedAction === -1) {
            return [];
        }

        if (isFirstLinkedActionRender.current) {
            return combinedReportActions.slice(indexOfLinkedAction);
        }
        const paginationSize = getInitialPaginationSize;
        return combinedReportActions.slice(Math.max(indexOfLinkedAction - paginationSize, 0));

        // currentReportActionID is needed to trigger batching once the report action has been positioned
        // eslint-disable-next-line react-compiler/react-compiler, react-hooks/exhaustive-deps
    }, [reportActionID, combinedReportActions, indexOfLinkedAction, currentReportActionID]);

    const reportActionIDMap = useMemo(() => {
        const reportActionIDs = allReportActions.map((action) => action.reportActionID);
        return reportActions.map((action) => ({
            reportActionID: action.reportActionID,
            reportID: reportActionIDs.includes(action.reportActionID) ? reportID : transactionThreadReport?.reportID,
        }));
    }, [allReportActions, reportID, transactionThreadReport, reportActions]);

    /**
     * Retrieves the next set of report actions for the chat once we are nearing the end of what we are currently
     * displaying.
     */
    const fetchNewerAction = useCallback(
        (newestReportAction: OnyxTypes.ReportAction) => {
            if (!hasNewerActions || isLoadingNewerReportActions || isLoadingInitialReportActions || (reportActionID && isOffline)) {
                return;
            }

            // If this is a one transaction report, ensure we load newer actions for both this report and the report associated with the transaction
            if (!isEmptyObject(transactionThreadReport)) {
                // Get newer actions based on the newest reportAction for the current report
                const newestActionCurrentReport = reportActionIDMap.find((item) => item.reportID === reportID);
                Report.getNewerActions(newestActionCurrentReport?.reportID ?? '-1', newestActionCurrentReport?.reportActionID ?? '-1');

                // Get newer actions based on the newest reportAction for the transaction thread report
                const newestActionTransactionThreadReport = reportActionIDMap.find((item) => item.reportID === transactionThreadReport.reportID);
                Report.getNewerActions(newestActionTransactionThreadReport?.reportID ?? '-1', newestActionTransactionThreadReport?.reportActionID ?? '-1');
            } else {
                Report.getNewerActions(reportID, newestReportAction.reportActionID);
            }
        },
        [isLoadingNewerReportActions, isLoadingInitialReportActions, reportActionID, isOffline, transactionThreadReport, reportActionIDMap, reportID, hasNewerActions],
    );

    const hasMoreCached = reportActions.length < combinedReportActions.length;
    const newestReportAction = useMemo(() => reportActions?.at(0), [reportActions]);
    const mostRecentIOUReportActionID = useMemo(() => ReportActionsUtils.getMostRecentIOURequestActionID(reportActions), [reportActions]);
    const hasCachedActionOnFirstRender = useInitialValue(() => reportActions.length > 0);
    const hasNewestReportAction = reportActions.at(0)?.created === report.lastVisibleActionCreated || reportActions.at(0)?.created === transactionThreadReport?.lastVisibleActionCreated;
    const oldestReportAction = useMemo(() => reportActions?.at(-1), [reportActions]);

    useEffect(() => {
        const wasLoginChangedDetected = prevAuthTokenType === CONST.AUTH_TOKEN_TYPES.ANONYMOUS && !session?.authTokenType;
        if (wasLoginChangedDetected && didUserLogInDuringSession() && isUserCreatedPolicyRoom(report)) {
            openReportIfNecessary();
        }
        // eslint-disable-next-line react-compiler/react-compiler, react-hooks/exhaustive-deps
    }, [session, report]);

    useEffect(() => {
        const prevShouldUseNarrowLayout = prevShouldUseNarrowLayoutRef.current;
        // If the view is expanded from mobile to desktop layout
        // we update the new marker position, mark the report as read, and fetch new report actions
        const didScreenSizeIncrease = prevShouldUseNarrowLayout && !shouldUseNarrowLayout;
        const didReportBecomeVisible = isReportFullyVisible && didScreenSizeIncrease;
        if (didReportBecomeVisible) {
            openReportIfNecessary();
        }
        // update ref with current state
        prevShouldUseNarrowLayoutRef.current = shouldUseNarrowLayout;
        // eslint-disable-next-line react-compiler/react-compiler, react-hooks/exhaustive-deps
    }, [shouldUseNarrowLayout, reportActions, isReportFullyVisible]);

    const onContentSizeChange = useCallback((w: number, h: number) => {
        contentListHeight.current = h;
    }, []);

    const handleReportActionPagination = useCallback(
        ({firstReportActionID}: {firstReportActionID: string}) => {
            // This function is a placeholder as the actual pagination is handled by visibleReportActions
            if (!hasMoreCached && !hasNewestReportAction) {
                isFirstLinkedActionRender.current = false;
                if (newestReportAction) {
                    fetchNewerAction(newestReportAction);
                }
            }
            if (isFirstLinkedActionRender.current) {
                isFirstLinkedActionRender.current = false;
            }
            setCurrentReportActionID(firstReportActionID);
        },
        [fetchNewerAction, hasMoreCached, newestReportAction, hasNewestReportAction],
    );

    /**
     * Retrieves the next set of report actions for the chat once we are nearing the end of what we are currently
     * displaying.
     */
    const loadOlderChats = useCallback(
        (force = false) => {
            // Only fetch more if we are neither already fetching (so that we don't initiate duplicate requests) nor offline.
            if (
                !force &&
                (!!network.isOffline ||
                    isLoadingOlderReportActions ||
                    // If there was an error only try again once on initial mount.
                    (didLoadOlderChats.current && hasLoadingOlderReportActionsError) ||
                    isLoadingInitialReportActions)
            ) {
                return;
            }

            // Don't load more chats if we're already at the beginning of the chat history
            if (!oldestReportAction || !hasOlderActions) {
                return;
            }

            didLoadOlderChats.current = true;

            if (!isEmptyObject(transactionThreadReport)) {
                // Get older actions based on the oldest reportAction for the current report
                const oldestActionCurrentReport = reportActionIDMap.findLast((item) => item.reportID === reportID);
                Report.getOlderActions(oldestActionCurrentReport?.reportID ?? '-1', oldestActionCurrentReport?.reportActionID ?? '-1');

                // Get older actions based on the oldest reportAction for the transaction thread report
                const oldestActionTransactionThreadReport = reportActionIDMap.findLast((item) => item.reportID === transactionThreadReport.reportID);
                Report.getOlderActions(oldestActionTransactionThreadReport?.reportID ?? '-1', oldestActionTransactionThreadReport?.reportActionID ?? '-1');
            } else {
                // Retrieve the next REPORT.ACTIONS.LIMIT sized page of comments
                Report.getOlderActions(reportID, oldestReportAction.reportActionID);
            }
        },
        [
            network.isOffline,
            isLoadingOlderReportActions,
            isLoadingInitialReportActions,
            oldestReportAction,
            reportID,
            reportActionIDMap,
            transactionThreadReport,
            hasLoadingOlderReportActionsError,
            hasOlderActions,
        ],
    );

    const loadNewerChats = useCallback(
        (force = false) => {
            if (
                !force &&
                (!reportActionID ||
                    !isFocused ||
                    (isLoadingInitialReportActions && !hasMoreCached) ||
                    isLoadingNewerReportActions ||
                    // If there was an error only try again once on initial mount. We should also still load
                    // more in case we have cached messages.
                    (!hasMoreCached && didLoadNewerChats.current && hasLoadingNewerReportActionsError) ||
                    newestReportAction?.pendingAction === CONST.RED_BRICK_ROAD_PENDING_ACTION.DELETE)
            ) {
                return;
            }

            didLoadNewerChats.current = true;

            if ((reportActionID && indexOfLinkedAction > -1) || !reportActionID) {
                handleReportActionPagination({firstReportActionID: newestReportAction?.reportActionID ?? '-1'});
            }
        },
        [
            isLoadingInitialReportActions,
            isLoadingNewerReportActions,
            reportActionID,
            indexOfLinkedAction,
            handleReportActionPagination,
            newestReportAction,
            isFocused,
            hasLoadingNewerReportActionsError,
            hasMoreCached,
        ],
    );

    /**
     * Runs when the FlatList finishes laying out
     */
    const recordTimeToMeasureItemLayout = useCallback(() => {
        if (didLayout.current) {
            return;
        }

        didLayout.current = true;
        // Capture the init measurement only once not per each chat switch as the value gets overwritten
        if (!ReportActionsView.initMeasured) {
            Performance.markEnd(CONST.TIMING.OPEN_REPORT);
            Performance.markEnd(CONST.TIMING.REPORT_INITIAL_RENDER);
            ReportActionsView.initMeasured = true;
        } else {
            Performance.markEnd(CONST.TIMING.SWITCH_REPORT);
        }
        Timing.end(CONST.TIMING.SWITCH_REPORT, hasCachedActionOnFirstRender ? CONST.TIMING.WARM : CONST.TIMING.COLD);
        Timing.end(CONST.TIMING.OPEN_REPORT_THREAD);
        Timing.end(CONST.TIMING.OPEN_REPORT_FROM_PREVIEW);
    }, [hasCachedActionOnFirstRender]);

    // Check if the first report action in the list is the one we're currently linked to
    const isTheFirstReportActionIsLinked = newestReportAction?.reportActionID === reportActionID;

    useEffect(() => {
        let timerID: NodeJS.Timeout;

        if (isTheFirstReportActionIsLinked) {
            setNavigatingToLinkedMessage(true);
        } else {
            // After navigating to the linked reportAction, apply this to correctly set
            // `autoscrollToTopThreshold` prop when linking to a specific reportAction.
            InteractionManager.runAfterInteractions(() => {
                // Using a short delay to ensure the view is updated after interactions
                timerID = setTimeout(() => setNavigatingToLinkedMessage(false), 10);
            });
        }

        return () => {
            if (!timerID) {
                return;
            }
            clearTimeout(timerID);
        };
    }, [isTheFirstReportActionIsLinked]);

    const sortedVisibleReportActions = useMemo(
        () =>
            reportActions.filter(
                (reportAction) =>
                    (isOffline ||
                        ReportActionsUtils.isDeletedParentAction(reportAction) ||
                        reportAction.pendingAction !== CONST.RED_BRICK_ROAD_PENDING_ACTION.DELETE ||
                        reportAction.errors) &&
                    ReportActionsUtils.shouldReportActionBeVisible(reportAction, reportAction.reportActionID),
            ),
        [reportActions, isOffline],
    );
    const lastAction = sortedVisibleReportActions.at(0);

    const sortedVisibleReportActionsObjects: OnyxTypes.ReportActions = useMemo(
        () =>
            sortedVisibleReportActions.reduce((actions, action) => {
                Object.assign(actions, {[action.reportActionID]: action});
                return actions;
            }, {}),
        [sortedVisibleReportActions],
    );
    const prevSortedVisibleReportActionsObjects = usePrevious(sortedVisibleReportActionsObjects);

    /**
     * The timestamp for the unread marker.
     *
     * This should ONLY be updated when the user
     * - switches reports
     * - marks a message as read/unread
     * - reads a new message as it is received
     */
    const [unreadMarkerTime, setUnreadMarkerTime] = useState(report.lastReadTime ?? '');
    useEffect(() => {
        setUnreadMarkerTime(report.lastReadTime ?? '');
        // eslint-disable-next-line react-compiler/react-compiler, react-hooks/exhaustive-deps
    }, [report.reportID]);

    const prevUnreadMarkerReportActionID = useRef<string | null>(null);
    /**
     * The reportActionID the unread marker should display above
     */
    const unreadMarkerReportActionID = useMemo(() => {
        const shouldDisplayNewMarker = (reportAction: OnyxTypes.ReportAction, index: number): boolean => {
            const nextMessage = sortedVisibleReportActions.at(index + 1);
            const isCurrentMessageUnread = isMessageUnread(reportAction, unreadMarkerTime);
            const isNextMessageRead = !nextMessage || !isMessageUnread(nextMessage, unreadMarkerTime);
            const shouldDisplay = isCurrentMessageUnread && isNextMessageRead && !ReportActionsUtils.shouldHideNewMarker(reportAction);
            const isWithinVisibleThreshold = scrollingVerticalOffset.current < MSG_VISIBLE_THRESHOLD ? reportAction.created < (userActiveSince.current ?? '') : true;

            // If no unread marker exists, don't set an unread marker for newly added messages from the current user.
            const isFromCurrentUser = accountID === (ReportActionsUtils.isReportPreviewAction(reportAction) ? !reportAction.childLastActorAccountID : reportAction.actorAccountID);
            const isNewMessage = !prevSortedVisibleReportActionsObjects[reportAction.reportActionID];
            // The unread marker will show if the action's `created` time is later than `unreadMarkerTime`.
            // The `unreadMarkerTime` has already been updated to match the optimistic action created time,
            // but once the new action is saved on the backend, the actual created time will be later than the optimistic one.
            // Therefore, we also need to prevent the unread marker from appearing for previously optimistic actions.
            const isPreviouslyOptimistic = !!prevSortedVisibleReportActionsObjects[reportAction.reportActionID]?.isOptimisticAction && !reportAction.isOptimisticAction;
            const shouldIgnoreUnreadForCurrentUserMessage = !prevUnreadMarkerReportActionID.current && isFromCurrentUser && (isNewMessage || isPreviouslyOptimistic);

            return shouldDisplay && isWithinVisibleThreshold && !shouldIgnoreUnreadForCurrentUserMessage;
        };

        // Scan through each visible report action until we find the appropriate action to show the unread marker
        for (let index = 0; index < sortedVisibleReportActions.length; index++) {
            const reportAction = sortedVisibleReportActions.at(index);

            // eslint-disable-next-line react-compiler/react-compiler
            if (reportAction && shouldDisplayNewMarker(reportAction, index)) {
                return reportAction.reportActionID;
            }
        }

        return null;
    }, [sortedVisibleReportActions, unreadMarkerTime, accountID, prevSortedVisibleReportActionsObjects]);
    prevUnreadMarkerReportActionID.current = unreadMarkerReportActionID;

    useEffect(() => {
        prevReportID = report.reportID;
        userActiveSince.current = DateUtils.getDBTime();
    }, [report.reportID]);

    useEffect(() => {
        if (report.reportID !== prevReportID) {
            return;
        }

        if (!isVisible || !isFocused) {
            if (!lastMessageTime.current) {
                lastMessageTime.current = lastAction?.created ?? '';
            }
            return;
        }

        // In case the user read new messages (after being inactive) with other device we should
        // show marker based on report.lastReadTime
        const newMessageTimeReference = lastMessageTime.current && report.lastReadTime && lastMessageTime.current > report.lastReadTime ? userActiveSince.current : report.lastReadTime;
        lastMessageTime.current = null;

        const isArchivedReport = ReportUtils.isArchivedRoom(report);
        const hasNewMessagesInView = scrollingVerticalOffset.current < MSG_VISIBLE_THRESHOLD;
        const hasUnreadReportAction = sortedVisibleReportActions.some(
            (reportAction) =>
                newMessageTimeReference &&
                newMessageTimeReference < reportAction.created &&
                (ReportActionsUtils.isReportPreviewAction(reportAction) ? reportAction.childLastActorAccountID : reportAction.actorAccountID) !== Report.getCurrentUserAccountID(),
        );

        if (!isArchivedReport && (!hasNewMessagesInView || !hasUnreadReportAction)) {
            return;
        }

        Report.readNewestAction(report.reportID);
        userActiveSince.current = DateUtils.getDBTime();

        // This effect logic to `mark as read` will only run when the report focused has new messages and the App visibility
        //  is changed to visible(meaning user switched to app/web, while user was previously using different tab or application).
        // We will mark the report as read in the above case which marks the LHN report item as read while showing the new message
        // marker for the chat messages received while the user wasn't focused on the report or on another browser tab for web.
        // eslint-disable-next-line react-compiler/react-compiler, react-hooks/exhaustive-deps
    }, [isFocused, isVisible]);

    useEffect(() => {
        if (report.reportID !== prevReportID) {
            return;
        }

        if (ReportUtils.isUnread(report)) {
            // On desktop, when the notification center is displayed, isVisible will return false.
            // Currently, there's no programmatic way to dismiss the notification center panel.
            // To handle this, we use the 'referrer' parameter to check if the current navigation is triggered from a notification.
            const isFromNotification = route?.params?.referrer === CONST.REFERRER.NOTIFICATION;
            if ((isVisible || isFromNotification) && scrollingVerticalOffset.current < MSG_VISIBLE_THRESHOLD) {
                Report.readNewestAction(report.reportID);
                if (isFromNotification) {
                    Navigation.setParams({referrer: undefined});
                }
            } else {
                readActionSkipped.current = true;
            }
        }
        // eslint-disable-next-line react-compiler/react-compiler, react-hooks/exhaustive-deps
    }, [report.lastVisibleActionCreated, report.reportID, isVisible]);

    const lastActionIndex = lastAction?.reportActionID;
    const previousLastIndex = useRef(lastActionIndex);
    const reportActionSize = useRef(sortedVisibleReportActions.length);

    const scrollToBottomAndMarkReportAsRead = () => {
        if (!hasNewestReportAction) {
            Navigation.navigate(ROUTES.REPORT_WITH_ID.getRoute(report.reportID));
            Report.openReport(report.reportID);
            reportScrollManager.scrollToBottom();
            return;
        }
        reportScrollManager.scrollToBottom();
        readActionSkipped.current = false;
        Report.readNewestAction(report.reportID);
    };

    useEffect(() => {
        if (
            scrollingVerticalOffset.current < AUTOSCROLL_TO_TOP_THRESHOLD &&
            previousLastIndex.current !== lastActionIndex &&
            reportActionSize.current > sortedVisibleReportActions.length &&
            hasNewestReportAction
        ) {
            reportScrollManager.scrollToBottom();
        }
        previousLastIndex.current = lastActionIndex;
        reportActionSize.current = sortedVisibleReportActions.length;
    }, [lastActionIndex, sortedVisibleReportActions, reportScrollManager, hasNewestReportAction, reportActionID]);

    /**
     * When the user reads a new message as it is received, we'll push the unreadMarkerTime down to the timestamp of
     * the latest report action. When new report actions are received and the user is not viewing them (they're above
     * the MSG_VISIBLE_THRESHOLD), the unread marker will display over those new messages rather than the initial
     * lastReadTime.
     */
    useEffect(() => {
        if (unreadMarkerReportActionID) {
            return;
        }

        const mostRecentReportActionCreated = lastAction?.created ?? '';
        if (mostRecentReportActionCreated <= unreadMarkerTime) {
            return;
        }

        setUnreadMarkerTime(mostRecentReportActionCreated);

        // eslint-disable-next-line react-compiler/react-compiler, react-hooks/exhaustive-deps
    }, [lastAction?.created]);

    /**
     * Subscribe to read/unread events and update our unreadMarkerTime
     */
    useEffect(() => {
        const unreadActionSubscription = DeviceEventEmitter.addListener(`unreadAction_${report.reportID}`, (newLastReadTime: string) => {
            setUnreadMarkerTime(newLastReadTime);
            userActiveSince.current = DateUtils.getDBTime();
        });
        const readNewestActionSubscription = DeviceEventEmitter.addListener(`readNewestAction_${report.reportID}`, (newLastReadTime: string) => {
            setUnreadMarkerTime(newLastReadTime);
        });

        return () => {
            unreadActionSubscription.remove();
            readNewestActionSubscription.remove();
        };
    }, [report.reportID]);

    const [isFloatingMessageCounterVisible, setIsFloatingMessageCounterVisible] = useState(false);

    /**
     * Show/hide the new floating message counter when user is scrolling back/forth in the history of messages.
     */
    const handleUnreadFloatingButton = () => {
        if (scrollingVerticalOffset.current > VERTICAL_OFFSET_THRESHOLD && !isFloatingMessageCounterVisible && !!unreadMarkerReportActionID) {
            setIsFloatingMessageCounterVisible(true);
        }

        if (scrollingVerticalOffset.current < VERTICAL_OFFSET_THRESHOLD && isFloatingMessageCounterVisible) {
            if (readActionSkipped.current) {
                readActionSkipped.current = false;
                Report.readNewestAction(report.reportID);
            }
            setIsFloatingMessageCounterVisible(false);
        }
    };

    const trackVerticalScrolling = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        scrollingVerticalOffset.current = event.nativeEvent.contentOffset.y;
        handleUnreadFloatingButton();
    };

    // Comments have not loaded at all yet do nothing
    if (!reportActions.length) {
        return null;
    }

    const isLastPendingActionIsDelete = sortedVisibleReportActions?.at(0)?.pendingAction === CONST.RED_BRICK_ROAD_PENDING_ACTION.DELETE;
    // When performing comment linking, initially 25 items are added to the list. Subsequent fetches add 15 items from the cache or 50 items from the server.
    // This is to ensure that the user is able to see the 'scroll to newer comments' button when they do comment linking and have not reached the end of the list yet.
    const canScrollToNewerComments = !isLoadingInitialReportActions && !hasNewestReportAction && sortedVisibleReportActions.length > 25 && !isLastPendingActionIsDelete;
    // AutoScroll is disabled when we do linking to a specific reportAction
    const shouldEnableAutoScroll = (hasNewestReportAction && (!reportActionID || !isNavigatingToLinkedMessage)) || (transactionThreadReport && !prevTransactionThreadReport);
    return (
        <>
            <FloatingMessageCounter
                isActive={(isFloatingMessageCounterVisible && !!unreadMarkerReportActionID) || canScrollToNewerComments}
                onClick={scrollToBottomAndMarkReportAsRead}
            />
            <ReportActionsList
                report={report}
                transactionThreadReport={transactionThreadReport}
                reportActions={reportActions}
                parentReportAction={parentReportAction}
                parentReportActionForTransactionThread={parentReportActionForTransactionThread}
                onLayout={recordTimeToMeasureItemLayout}
                sortedVisibleReportActions={sortedVisibleReportActions}
                mostRecentIOUReportActionID={mostRecentIOUReportActionID}
                loadOlderChats={loadOlderChats}
                loadNewerChats={loadNewerChats}
                isLoadingInitialReportActions={isLoadingInitialReportActions}
                isLoadingOlderReportActions={isLoadingOlderReportActions}
                hasLoadingOlderReportActionsError={hasLoadingOlderReportActionsError}
                isLoadingNewerReportActions={isLoadingNewerReportActions}
                hasLoadingNewerReportActionsError={hasLoadingNewerReportActionsError}
                listID={listID}
                onContentSizeChange={onContentSizeChange}
                shouldEnableAutoScrollToTopThreshold={shouldEnableAutoScroll}
                onScroll={trackVerticalScrolling}
            />
            <UserTypingEventListener report={report} />
            <PopoverReactionList ref={reactionListRef} />
        </>
    );
}

ReportActionsView.displayName = 'ReportActionsView';
ReportActionsView.initMeasured = false;

function arePropsEqual(oldProps: ReportActionsViewProps, newProps: ReportActionsViewProps): boolean {
    if (!lodashIsEqual(oldProps.reportActions, newProps.reportActions)) {
        return false;
    }

    if (!lodashIsEqual(oldProps.parentReportAction, newProps.parentReportAction)) {
        return false;
    }

    if (oldProps.isLoadingInitialReportActions !== newProps.isLoadingInitialReportActions) {
        return false;
    }

    if (oldProps.isLoadingOlderReportActions !== newProps.isLoadingOlderReportActions) {
        return false;
    }

    if (oldProps.isLoadingNewerReportActions !== newProps.isLoadingNewerReportActions) {
        return false;
    }

    if (oldProps.hasLoadingOlderReportActionsError !== newProps.hasLoadingOlderReportActionsError) {
        return false;
    }

    if (oldProps.hasLoadingNewerReportActionsError !== newProps.hasLoadingNewerReportActionsError) {
        return false;
    }

    if (oldProps.hasNewerActions !== newProps.hasNewerActions) {
        return false;
    }

    if (oldProps.hasOlderActions !== newProps.hasOlderActions) {
        return false;
    }

    return lodashIsEqual(oldProps.report, newProps.report);
}

const MemoizedReportActionsView = React.memo(ReportActionsView, arePropsEqual);

export default Performance.withRenderTrace({id: '<ReportActionsView> rendering'})(MemoizedReportActionsView);
