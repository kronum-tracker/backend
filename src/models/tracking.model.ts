import { Schema, model } from 'mongoose';

const ref = { type: Schema.Types.ObjectId, ref: 'User', required: true };
export const Session = model(
    'Session',
    new Schema({
        tokenHash: { type: String, required: true, unique: true },
        user: ref,
        expiresAt: { type: Date, required: true, index: { expires: 0 } },
    }),
);

const tagSchema = new Schema({
    name: { type: String, required: true, maxlength: 40 },
    color: { type: String, required: true },
});
export const Project = model(
    'Project',
    new Schema(
        {
            name: { type: String, required: true, maxlength: 100 },
            description: { type: String, default: '', maxlength: 2000 },
            color: { type: String, default: '#6759e8' },
            owner: ref,
            members: [ref],
            tags: [tagSchema],
        },
        { timestamps: true },
    ),
);

const invitationSchema = new Schema(
    {
        project: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
        email: { type: String, required: true },
        invitedBy: ref,
        status: {
            type: String,
            enum: ['pending', 'accepted', 'declined', 'cancelled'],
            default: 'pending',
        },
    },
    { timestamps: true },
);
invitationSchema.index(
    { project: 1, email: 1 },
    { unique: true, partialFilterExpression: { status: 'pending' } },
);
export const Invitation = model('Invitation', invitationSchema);

const entrySchema = new Schema(
    {
        project: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
        description: { type: String, required: true, maxlength: 2000 },
        start: { type: Date, required: true },
        end: { type: Date, default: null },
        timerUser: { type: Schema.Types.ObjectId, ref: 'User' },
        assignees: [ref],
        tags: [{ type: Schema.Types.ObjectId }],
        createdBy: ref,
    },
    { timestamps: true },
);
entrySchema.index({ project: 1, start: -1 });
entrySchema.index(
    { timerUser: 1 },
    { unique: true, partialFilterExpression: { timerUser: { $type: 'objectId' }, end: null } },
);
export const TimeEntry = model('TimeEntry', entrySchema);
