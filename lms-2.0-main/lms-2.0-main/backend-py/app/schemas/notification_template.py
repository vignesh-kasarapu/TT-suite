from pydantic import BaseModel, ConfigDict


class NotificationTemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    template_key: str
    subject_template: str
    body_template: str
    is_active: bool


class NotificationTemplateCreateIn(BaseModel):
    template_key: str
    subject_template: str
    body_template: str


class NotificationTemplateUpdateIn(BaseModel):
    subject_template: str
    body_template: str


class NotificationTemplateActiveIn(BaseModel):
    is_active: bool
