package system

import (
	"gitee.com/nichanghao/gdmin/common"
)

type SysRole struct {
	Id    uint64    `gorm:"primarykey;comment:角色ID" json:"id"`
	Name  string    `gorm:"type:varchar(32);comment:角色名" json:"name"`
	Code  string    `gorm:"type:varchar(32);comment:角色标识" json:"code"`
	Desc  string    `gorm:"type:varchar(255);comment:备注" json:"desc"`
	Users []SysUser `gorm:"many2many:sys_user_role;" json:"users"` // 角色与用户的多对多关系
	common.BaseDO
}
