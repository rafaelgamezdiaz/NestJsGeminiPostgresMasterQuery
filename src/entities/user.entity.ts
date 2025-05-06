import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import { Sale } from "./sale.entity";

@Entity('users') // Nombre de la tabla en la BD
export class User {

    @PrimaryGeneratedColumn()
    id: number;

    @Column({ length: 100 })
    name: string;

    @Column({ length: 100, unique: true })
    email: string;

    @Column({ length: 100 })
    password: string;


    @Column({ type: 'timestamp' })
    createdAt: Date;

    @OneToMany(() => Sale, sale => sale.user)
    sales: Sale[];
}