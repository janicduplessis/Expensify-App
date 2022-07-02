import _ from 'underscore';
import lodashGet from 'lodash/get';
import React from 'react';
import {View} from 'react-native';
import moment from 'moment';
import {withOnyx} from 'react-native-onyx';
import PropTypes from 'prop-types';
import HeaderWithCloseButton from '../../components/HeaderWithCloseButton';
import CONST from '../../CONST';
import * as BankAccounts from '../../libs/actions/BankAccounts';
import Navigation from '../../libs/Navigation/Navigation';
import Text from '../../components/Text';
import DatePicker from '../../components/DatePicker';
import TextInput from '../../components/TextInput';
import styles from '../../styles/styles';
import CheckboxWithLabel from '../../components/CheckboxWithLabel';
import TextLink from '../../components/TextLink';
import StatePicker from '../../components/StatePicker';
import withLocalize, {withLocalizePropTypes} from '../../components/withLocalize';
import * as ValidationUtils from '../../libs/ValidationUtils';
import * as LoginUtils from '../../libs/LoginUtils';
import compose from '../../libs/compose';
import ONYXKEYS from '../../ONYXKEYS';
import Picker from '../../components/Picker';
import AddressForm from './AddressForm';
import ReimbursementAccountForm from './ReimbursementAccountForm';
import * as ReimbursementAccount from '../../libs/actions/ReimbursementAccount';
import * as ReimbursementAccountUtils from '../../libs/ReimbursementAccountUtils';

const propTypes = {
    ...withLocalizePropTypes,
    reimbursementAccountDraft: PropTypes.shape(CONST.BANK_ACCOUNT.REIMBURSEMENT_ACCOUNT_DRAFT_PROPS),
};

const defaultProps = {
    reimbursementAccountDraft: {
        companyName: '',
        addressStreet: '',
        addressCity: '',
        addressState: '',
        addressZipCode: '',
        companyPhone: '',
        website: '',
        companyTaxID: '',
        incorporationType: '',
        incorporationDate: '',
        incorporationState: '',
        hasNoConnectionToCannabis: false,
    },
};

class CompanyStep extends React.Component {
    constructor(props) {
        super(props);

        this.submit = this.submit.bind(this);

        // These fields need to be filled out in order to submit the form
        this.requiredFields = [
            'companyName',
            'addressStreet',
            'addressCity',
            'addressState',
            'addressZipCode',
            'website',
            'companyTaxID',
            'incorporationDate',
            'incorporationState',
            'incorporationType',
            'companyPhone',
            'hasNoConnectionToCannabis',
        ];

        // Map a field to the key of the error's translation
        this.errorTranslationKeys = {
            companyName: 'bankAccount.error.companyName',
            companyPhone: 'bankAccount.error.phoneNumber',
            website: 'bankAccount.error.website',
            companyTaxID: 'bankAccount.error.taxID',
            incorporationDate: 'bankAccount.error.incorporationDate',
            incorporationDateFuture: 'bankAccount.error.incorporationDateFuture',
            incorporationType: 'bankAccount.error.companyType',
            hasNoConnectionToCannabis: 'bankAccount.error.restrictedBusiness',
            incorporationState: 'bankAccount.error.incorporationState',
        };

        this.clearError = inputKey => ReimbursementAccountUtils.clearError(this.props, inputKey);
        this.getErrorText = inputKey => ReimbursementAccountUtils.getErrorText(this.props, this.errorTranslationKeys, inputKey);
        this.getErrors = () => ReimbursementAccountUtils.getErrors(this.props);
    }

    /**
     * @returns {Boolean}
     */
    validate() {
        const errorFields = {};

        if (!ValidationUtils.isValidAddress(this.props.reimbursementAccountDraft.addressStreet)) {
            errorFields.addressStreet = true;
        }

        if (!ValidationUtils.isValidZipCode(this.props.reimbursementAccountDraft.addressZipCode)) {
            errorFields.addressZipCode = true;
        }

        if (!ValidationUtils.isValidURL(this.props.reimbursementAccountDraft.website)) {
            errorFields.website = true;
        }

        if (!ValidationUtils.isValidTaxID(this.props.reimbursementAccountDraft.companyTaxID)) {
            errorFields.companyTaxID = true;
        }

        if (!ValidationUtils.isValidDate(this.props.reimbursementAccountDraft.incorporationDate)) {
            errorFields.incorporationDate = true;
        }

        if (!ValidationUtils.isValidPastDate(this.props.reimbursementAccountDraft.incorporationDate)) {
            errorFields.incorporationDateFuture = true;
        }

        if (!ValidationUtils.isValidUSPhone(this.props.reimbursementAccountDraft.companyPhone, true)) {
            errorFields.companyPhone = true;
        }

        _.each(this.requiredFields, (inputKey) => {
            if (ValidationUtils.isRequiredFulfilled(this.props.reimbursementAccountDraft[inputKey])) {
                return;
            }

            errorFields[inputKey] = true;
        });

        ReimbursementAccount.setBankAccountFormValidationErrors(errorFields);

        return _.size(errorFields) === 0;
    }

    submit() {
        if (!this.validate()) {
            return;
        }

        const incorporationDate = moment(this.props.reimbursementAccountDraft.incorporationDate).format(CONST.DATE.MOMENT_FORMAT_STRING);
        BankAccounts.updateCompanyInfoForVBBA({
            ...this.props.reimbursementAccountDraft,
            incorporationDate,
            companyTaxID: this.props.reimbursementAccountDraft.companyTaxID.replace(CONST.REGEX.NON_NUMERIC, ''),
            companyPhone: LoginUtils.getPhoneNumberWithoutUSCountryCodeAndSpecialChars(this.props.reimbursementAccountDraft.companyPhone),
        });
    }

    /**
     * @param {String} fieldName
     * @param {String} value
     */
    clearErrorAndSetValue(fieldName, value) {
        ReimbursementAccount.updateReimbursementAccountDraft({[fieldName]: value});
        this.clearError(fieldName);

        if (fieldName === 'incorporationDate') {
            this.clearError('incorporationDateFuture');
        }
    }

    render() {
        const shouldDisableCompanyName = this.props.reimbursementAccountDraft.bankAccountID && this.props.reimbursementAccountDraft.companyName;
        const shouldDisableCompanyTaxID = this.props.reimbursementAccountDraft.bankAccountID && this.props.reimbursementAccountDraft.companyTaxID;

        return (
            <>
                <HeaderWithCloseButton
                    title={this.props.translate('companyStep.headerTitle')}
                    stepCounter={{step: 2, total: 5}}
                    shouldShowGetAssistanceButton
                    guidesCallTaskID={CONST.GUIDES_CALL_TASK_IDS.WORKSPACE_BANK_ACCOUNT}
                    shouldShowBackButton
                    onBackButtonPress={() => BankAccounts.goToWithdrawalAccountSetupStep(CONST.BANK_ACCOUNT.STEP.BANK_ACCOUNT)}
                    onCloseButtonPress={Navigation.dismissModal}
                />

                <ReimbursementAccountForm onSubmit={this.submit}>
                    <Text>{this.props.translate('companyStep.subtitle')}</Text>
                    <TextInput
                        label={this.props.translate('companyStep.legalBusinessName')}
                        containerStyles={[styles.mt4]}
                        onChangeText={value => this.clearErrorAndSetValue('companyName', value)}
                        defaultValue={this.props.reimbursementAccountDraft.companyName}
                        disabled={shouldDisableCompanyName}
                        errorText={this.getErrorText('companyName')}
                    />
                    <AddressForm
                        streetTranslationKey="common.companyAddress"
                        values={{
                            street: this.props.reimbursementAccountDraft.addressStreet,
                            city: this.props.reimbursementAccountDraft.addressCity,
                            zipCode: this.props.reimbursementAccountDraft.addressZipCode,
                            state: this.props.reimbursementAccountDraft.addressState,
                        }}
                        errors={{
                            street: this.getErrors().addressStreet,
                            city: this.getErrors().addressCity,
                            zipCode: this.getErrors().addressZipCode,
                            state: this.getErrors().addressState,
                        }}
                        onFieldChange={(values) => {
                            const renamedFields = {
                                street: 'addressStreet',
                                state: 'addressState',
                                city: 'addressCity',
                                zipCode: 'addressZipCode',
                            };
                            _.each(values, (value, inputKey) => {
                                const renamedInputKey = lodashGet(renamedFields, inputKey, inputKey);
                                ReimbursementAccount.updateReimbursementAccountDraft({[renamedInputKey]: value});
                                this.clearError(renamedInputKey);
                            });
                        }}
                    />
                    <TextInput
                        label={this.props.translate('common.phoneNumber')}
                        containerStyles={[styles.mt4]}
                        keyboardType={CONST.KEYBOARD_TYPE.PHONE_PAD}
                        onChangeText={value => this.clearErrorAndSetValue('companyPhone', value)}
                        defaultValue={this.props.reimbursementAccountDraft.companyPhone}
                        placeholder={this.props.translate('common.phoneNumberPlaceholder')}
                        errorText={this.getErrorText('companyPhone')}
                    />
                    <TextInput
                        label={this.props.translate('companyStep.companyWebsite')}
                        containerStyles={[styles.mt4]}
                        onChangeText={value => this.clearErrorAndSetValue('website', value)}
                        defaultValue={this.props.reimbursementAccountDraft.website}
                        errorText={this.getErrorText('website')}
                    />
                    <TextInput
                        label={this.props.translate('companyStep.taxIDNumber')}
                        containerStyles={[styles.mt4]}
                        keyboardType={CONST.KEYBOARD_TYPE.NUMBER_PAD}
                        onChangeText={value => this.clearErrorAndSetValue('companyTaxID', value)}
                        defaultValue={this.props.reimbursementAccountDraft.companyTaxID}
                        disabled={shouldDisableCompanyTaxID}
                        placeholder={this.props.translate('companyStep.taxIDNumberPlaceholder')}
                        errorText={this.getErrorText('companyTaxID')}
                    />
                    <View style={styles.mt4}>
                        <Picker
                            label={this.props.translate('companyStep.companyType')}
                            items={_.map(this.props.translate('companyStep.incorporationTypes'), (label, value) => ({value, label}))}
                            onInputChange={value => this.clearErrorAndSetValue('incorporationType', value)}
                            defaultValue={this.props.reimbursementAccountDraft.incorporationType}
                            placeholder={{value: '', label: '-'}}
                            errorText={this.getErrorText('incorporationType')}
                        />
                    </View>
                    <View style={styles.mt4}>
                        <DatePicker
                            label={this.props.translate('companyStep.incorporationDate')}
                            onInputChange={value => this.clearErrorAndSetValue('incorporationDate', value)}
                            defaultValue={this.props.reimbursementAccountDraft.incorporationDate}
                            placeholder={this.props.translate('companyStep.incorporationDatePlaceholder')}
                            errorText={this.getErrorText('incorporationDate') || this.getErrorText('incorporationDateFuture')}
                            maximumDate={new Date()}
                        />
                    </View>
                    <View style={styles.mt4}>
                        <StatePicker
                            label={this.props.translate('companyStep.incorporationState')}
                            onInputChange={value => this.clearErrorAndSetValue('incorporationState', value)}
                            defaultValue={this.props.reimbursementAccountDraft.incorporationState}
                            errorText={this.getErrorText('incorporationState')}
                        />
                    </View>
                    <CheckboxWithLabel
                        isChecked={this.props.reimbursementAccountDraft.hasNoConnectionToCannabis}
                        onInputChange={value => this.clearErrorAndSetValue('hasNoConnectionToCannabis', value)}
                        LabelComponent={() => (
                            <>
                                <Text>{`${this.props.translate('companyStep.confirmCompanyIsNot')} `}</Text>
                                <TextLink
                                    // eslint-disable-next-line max-len
                                    href="https://community.expensify.com/discussion/6191/list-of-restricted-businesses"
                                >
                                    {`${this.props.translate('companyStep.listOfRestrictedBusinesses')}.`}
                                </TextLink>
                            </>
                        )}
                        style={[styles.mt4]}
                        errorText={this.getErrorText('hasNoConnectionToCannabis')}
                    />
                </ReimbursementAccountForm>
            </>
        );
    }
}

CompanyStep.propTypes = propTypes;
CompanyStep.defaultProps = defaultProps;
export default compose(
    withLocalize,
    withOnyx({
        reimbursementAccount: {
            key: ONYXKEYS.REIMBURSEMENT_ACCOUNT,
        },
        reimbursementAccountDraft: {
            key: ONYXKEYS.REIMBURSEMENT_ACCOUNT_DRAFT,
        },
    }),
)(CompanyStep);
